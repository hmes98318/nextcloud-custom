ARG NEXTCLOUD_VERSION=32.0.15
ARG NGINX_VERSION=1.30.8

ARG DEBIAN_IMAGE=debian:12.15
ARG PHP_IMAGE=php:8.3.37-fpm-bookworm
ARG PIE_IMAGE=ghcr.io/php/pie:1.4.5-bin


###############################################################
# Build the nginx Brotli dynamic module
###############################################################

FROM ${DEBIAN_IMAGE} AS nginx_builder


ARG NGINX_VERSION


RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    wget \
    build-essential \
    dpkg-dev \
    cmake \
    unzip \
    zlib1g-dev \
    libpcre3-dev \
    libssl-dev \
    pkg-config \
    autoconf \
    automake \
    libtool;

# Install brotli
RUN cd /opt && \
    git clone --recurse-submodules -j8 https://github.com/google/ngx_brotli && \
    cd ngx_brotli/deps/brotli && \
    mkdir out && cd out && \
    cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_C_FLAGS="-Ofast -flto -funroll-loops -ffunction-sections -fdata-sections -Wl,--gc-sections" -DCMAKE_CXX_FLAGS="-Ofast -flto -funroll-loops -ffunction-sections -fdata-sections -Wl,--gc-sections" -DCMAKE_INSTALL_PREFIX=./installed .. && \
    cmake --build . --config Release --target brotlienc && \
    cd ../../../.. && \
    wget https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz && \
    tar -zxvf nginx-${NGINX_VERSION}.tar.gz && \
    cd nginx-${NGINX_VERSION} && \
    ./configure --with-compat --add-dynamic-module=/opt/ngx_brotli && \
    make modules && \
    cp objs/*.so /tmp/


###############################################################
# PIE (PHP Installer for Extensions)
###############################################################

FROM ${PIE_IMAGE} AS pie


###############################################################
# Download and verify Nextcloud
###############################################################

FROM ${DEBIAN_IMAGE} AS nextcloud_src


ARG NEXTCLOUD_VERSION


RUN set -ex; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        bzip2 \
        ca-certificates \
        curl \
        dirmngr \
        gnupg \
    ; \
    \
    curl -fsSL -o nextcloud.tar.bz2 "https://download.nextcloud.com/server/releases/nextcloud-${NEXTCLOUD_VERSION}.tar.bz2"; \
    curl -fsSL -o nextcloud.tar.bz2.asc "https://download.nextcloud.com/server/releases/nextcloud-${NEXTCLOUD_VERSION}.tar.bz2.asc"; \
    export GNUPGHOME="$(mktemp -d)"; \
    gpg --batch --keyserver keyserver.ubuntu.com --recv-keys 28806A878AE423A28372792ED75899B9A724937A; \
    gpg --batch --verify nextcloud.tar.bz2.asc nextcloud.tar.bz2; \
    tar -xjf nextcloud.tar.bz2 -C /usr/src/; \
    gpgconf --kill all; \
    rm -rf "$GNUPGHOME" nextcloud.tar.bz2 nextcloud.tar.bz2.asc /usr/src/nextcloud/updater; \
    \
    mkdir -p /usr/src/nextcloud/custom_apps; \
    find /usr/src/nextcloud -type d -exec chmod 0755 {} +; \
    find /usr/src/nextcloud -type f -exec chmod 0644 {} +; \
    chmod 0755 /usr/src/nextcloud/occ


###############################################################
# Runtime image
###############################################################

FROM ${PHP_IMAGE} AS runtime


ARG NGINX_VERSION


# Each of the following layers runs its own apt-get update, so a layer that is
# rebuilt on its own never installs from outdated package lists. The apt package
# lists are removed once, at the end of the last apt layer (PHP extensions).

# System packages: maintenance tools and runtime dependencies
RUN set -eux; \
    \
    apt-get update; \
    # Apply the pending Debian security updates on top of the base image
    apt-get upgrade -y; \
    apt-get install -y --no-install-recommends \
        sudo \
        cron \
        fail2ban \
        python3-pyinotify \
        iptables \
        iputils-ping \
        procps \
        vim \
        busybox-static \
        bzip2 \
        libldap-common \
        libmagickcore-6.q16-6-extra \
        rsync \
        supervisor \
        ffmpeg \
    ;


# Install Nginx from official repo
RUN set -eux; \
    \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        curl \
        gnupg2 \
        ca-certificates \
        lsb-release \
        debian-archive-keyring \
    ; \
    curl https://nginx.org/keys/nginx_signing.key \
    | gpg --dearmor > /usr/share/keyrings/nginx-archive-keyring.gpg; \
    gpg --dry-run --quiet --no-keyring --import --import-options import-show /usr/share/keyrings/nginx-archive-keyring.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/debian $(lsb_release -cs) nginx" > /etc/apt/sources.list.d/nginx.list; \
    echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/mainline/debian $(lsb_release -cs) nginx" >> /etc/apt/sources.list.d/nginx.list; \
    printf "Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n" > /etc/apt/preferences.d/99nginx; \
    apt-get update; \
    apt-get install -y --no-install-recommends nginx=${NGINX_VERSION}-1~$(lsb_release -cs); \
    id nginx


# PHP extensions
RUN --mount=type=bind,from=pie,source=/pie,target=/usr/local/bin/pie \
    set -eux; \
    \
    savedAptMark="$(apt-mark showmanual)"; \
    \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        libcurl4-openssl-dev \
        libevent-dev \
        libfreetype6-dev \
        libgmp-dev \
        libicu-dev \
        libjpeg-dev \
        libldap2-dev \
        libmagickwand-dev \
        libmcrypt-dev \
        libmemcached-dev \
        libtool \
        libpng-dev \
        libpq-dev \
        libwebp-dev \
        libxml2-dev \
        libzip-dev \
        unzip \
        # https://github.com/docker-library/php/issues/1488
        libssl-dev \
    ; \
    \
    debMultiarch="$(dpkg-architecture --query DEB_BUILD_MULTIARCH)"; \
    docker-php-ext-configure ftp --with-openssl-dir=/usr; \
    docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp; \
    docker-php-ext-configure ldap --with-libdir="lib/$debMultiarch"; \
    docker-php-ext-install -j "$(nproc)" \
        bcmath \
        exif \
        ftp \
        gd \
        gmp \
        intl \
        ldap \
        opcache \
        pcntl \
        pdo_mysql \
        pdo_pgsql \
        sysvsem \
        zip \
    ; \
    \
    pie install --no-cache apcu/apcu:5.1.24; \
    pie install --no-cache imagick/imagick:3.8.0; \
    pie install --no-cache php-memcached/php-memcached:3.3.0; \
    pie install --no-cache phpredis/phpredis:6.2.0; \
    \
    apt-mark auto '.*' > /dev/null; \
    apt-mark manual $savedAptMark; \
    ldd "$(php -r 'echo ini_get("extension_dir");')"/*.so \
        | awk '/=>/ { so = $(NF-1); if (index(so, "/usr/local/") == 1) { next }; gsub("^/(usr/)?", "", so); print so }' \
        | sort -u \
        | xargs -r dpkg-query --search \
        | cut -d: -f1 \
        | sort -u \
        | xargs -rt apt-mark manual; \
    \
    apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \
    rm -rf /var/lib/apt/lists/*


# Install Nginx Brotli module
COPY --from=nginx_builder /tmp/*.so /usr/lib/nginx/modules/


RUN mkdir -p /var/spool/cron/crontabs; \
    echo '*/5 * * * * php --define apc.enable_cli=1 -f /var/www/html/cron.php' > /var/spool/cron/crontabs/www-data; \
    echo '*/5 * * * * php /var/www/html/occ preview:pre-generate -v' >> /var/spool/cron/crontabs/www-data


# Nextcloud
# The data directory is /var/www/html/nextclouddata, not the official default
# /var/www/html/data, so the volume can be mounted there with the right owner.
# RUN rm -f /usr/local/src/config/*
# COPY ./overlay/config /usr/local/src/config/


COPY --from=nextcloud_src --chown=www-data:www-data /usr/src/nextcloud/ /var/www/html/
COPY --chown=www-data:www-data ./overlay/config/autoconfig.php /var/www/html/config/autoconfig.php

RUN chown www-data:www-data /var/www/html && \
    chmod 0755 /var/www/html && \
    install -d -o www-data -g www-data -m 0750 /var/www/nextcloud-sessions-tmp && \
    install -d -o www-data -g www-data -m 0750 /var/www/html/config && \
    install -d -o www-data -g www-data -m 0750 /var/www/html/nextclouddata && \
    install -d -o www-data -g www-data -m 0755 /var/www/html/install-apps && \
    install -d -o nginx -g nginx -m 0750 /var/tmp/nginx_client_body_temp




RUN rm -f /usr/local/etc/php-fpm.d/* && \
    mkdir -p \
    /var/log/php-fpm \
    /var/log/nginx \
    /var/log/supervisord;

COPY ./overlay/nginx/nginx.conf /etc/nginx/nginx.conf
COPY ./overlay/nginx/conf.d /etc/nginx/conf.d
# Remove the nginx package's default welcome-page server so it cannot shadow
# our server blocks (e.g. requests with "Host: localhost" or over IPv6).
RUN rm -f /etc/nginx/conf.d/default.conf

COPY ./overlay/php /usr/local/etc/php/conf.d/
COPY ./overlay/php-fpm.d /usr/local/etc/php-fpm.d/

COPY ./overlay/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

COPY ./overlay/cron.sh /
COPY ./overlay/scripts/nextcloud_upgrade.sh /usr/local/sbin/nextcloud-upgrade
COPY ./overlay/scripts/fail2ban_start.sh /usr/local/sbin/fail2ban-start
COPY ./overlay/scripts/container_start.sh /usr/local/sbin/container-start

RUN chmod 0755 /cron.sh /usr/local/sbin/nextcloud-upgrade /usr/local/sbin/fail2ban-start /usr/local/sbin/container-start


# The self-signed TLS certificate is generated by container-start at every
# start unless a certificate is mounted here, so no private key ships in the image.
RUN mkdir -p /etc/nginx/ssl


# fail2ban disable sshd
RUN sed -i 's/enabled = true/enabled = false/g' /etc/fail2ban/jail.d/defaults-debian.conf && \
    rm -r /etc/fail2ban/filter.d/*

COPY ./overlay/fail2ban/filter.d/nextcloud.conf /etc/fail2ban/filter.d/nextcloud.conf
COPY ./overlay/fail2ban/jail.d/nextcloud.local /etc/fail2ban/jail.d/nextcloud.local


# Fails when any supervisord program is not running
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD supervisorctl status > /dev/null || exit 1

CMD ["/usr/local/sbin/container-start"]
