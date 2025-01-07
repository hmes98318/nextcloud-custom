FROM php:8.2-fpm-bookworm


ENV NEXTCLOUD_VERSION=29.0.10


# Maintenance tools
RUN apt-get update; \
    apt-get install -y \
    sudo \
    cron \
    iputils-ping \
    procps \
    vim;


RUN set -eux; \
    \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        busybox-static \
        bzip2 \
        libldap-common \
        libmagickcore-6.q16-6-extra \
        rsync \
        nginx \
        supervisor \
        ffmpeg \
    ; \
    rm -rf /var/lib/apt/lists/*;


RUN mkdir -p /var/spool/cron/crontabs; \
    echo '*/5 * * * * php --define apc.enable_cli=1 -f /var/www/html/cron.php' > /var/spool/cron/crontabs/www-data; \
    echo '*/5 * * * * php /var/www/html/occ preview:pre-generate -v' >> /var/spool/cron/crontabs/www-data


RUN set -ex; \
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
        libpng-dev \
        libpq-dev \
        libwebp-dev \
        libxml2-dev \
        libzip-dev \
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
    pecl install APCu-5.1.24; \
    pecl install imagick-3.7.0; \
    pecl install memcached-3.3.0; \
    pecl install redis-6.1.0; \
    \
    docker-php-ext-enable \
        apcu \
        imagick \
        memcached \
        redis \
    ; \
    rm -r /tmp/pear; \
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




RUN set -ex; \
    fetchDeps=" \
        gnupg \
        dirmngr \
    "; \
    apt-get update; \
    apt-get install -y --no-install-recommends $fetchDeps; \
    \
    curl -fsSL -o nextcloud.tar.bz2 "https://download.nextcloud.com/server/releases/nextcloud-${NEXTCLOUD_VERSION}.tar.bz2"; \
    curl -fsSL -o nextcloud.tar.bz2.asc "https://download.nextcloud.com/server/releases/nextcloud-${NEXTCLOUD_VERSION}.tar.bz2.asc"; \
    export GNUPGHOME="$(mktemp -d)"; \
    gpg --batch --keyserver keyserver.ubuntu.com --recv-keys 28806A878AE423A28372792ED75899B9A724937A; \
    gpg --batch --verify nextcloud.tar.bz2.asc nextcloud.tar.bz2; \
    tar -xjf nextcloud.tar.bz2 -C /usr/src/; \
    gpgconf --kill all; \
    rm nextcloud.tar.bz2.asc nextcloud.tar.bz2; \
    rm -rf "$GNUPGHOME" /usr/src/nextcloud/updater; \
    mkdir -p /usr/src/nextcloud/data; \
    mkdir -p /usr/src/nextcloud/custom_apps; \
    chmod +x /usr/src/nextcloud/occ; \
    \
    apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false $fetchDeps; \
    rm -rf /var/lib/apt/lists/*


# RUN rm -f /usr/local/src/config/*
# COPY ./overlay/config /usr/local/src/config/


RUN rsync -a --exclude='updater' /usr/src/nextcloud/ /var/www/html/ && \
    rm -rf /usr/src/nextcloud && \
    mkdir -p /var/www/html/nextcloud-sessions-tmp && \
    chown -R www-data:www-data /var/www/html



RUN rm -f /usr/local/etc/php-fpm.d/* && \
    mkdir -p \
    /var/log/php-fpm \
    /var/log/nginx \
    /var/log/supervisord;

COPY ./overlay/nginx/nginx.conf /etc/nginx/nginx.conf
COPY ./overlay/nginx/conf.d /etc/nginx/conf.d

COPY ./overlay/php /usr/local/etc/php/conf.d/
COPY ./overlay/php-fpm.d /usr/local/etc/php-fpm.d/

COPY ./overlay/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

COPY ./overlay/cron.sh /

RUN chmod +x /cron.sh


# SSL self-signed certificate
RUN mkdir -p /etc/nginx/ssl && \
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout /etc/nginx/ssl/nginx.key -out /etc/nginx/ssl/nginx.crt \
    -subj "/C=US/ST=California/L=Los Angeles/O=MyCompany/CN=example.com"




CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

