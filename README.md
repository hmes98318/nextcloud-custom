# nextcloud-custom
基於 Nextcloud 官方 image 修改的容器  
修改成自託管 Nextcloud server 所需架構  

- **Web 服務**：使用 Nginx + PHP-FPM
- **資料庫**：連接外部的 MariaDB, Redis 
- **存儲**：Nextcloud data 使用 NFS 掛載外部存儲 server (TrueNAS CORE)
- **進程管理**：使用 Supervisord 掛載並管理所有相關進程。


## License
Copyright (C) 2025  [hmes98318](https://github.com/hmes98318)  

Source: https://github.com/nextcloud/docker  

The custom Nextcloud image is licensed under the **GNU General Public License v3.0**, see the [LICENCE](./LICENSE) file for details.  
