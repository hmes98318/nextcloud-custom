# nextcloud-custom
基於 Nextcloud 官方 image 修改的容器  
修改成自託管 Nextcloud server 所需架構  

- **Web 服務**：使用 Nginx + PHP-FPM
- **資料庫**：連接外部的 MariaDB, Redis 
- **存儲**：Nextcloud data 使用 NFS 掛載外部存儲 server (TrueNAS CORE)
- **進程管理**：使用 Supervisord 掛載並管理所有相關進程。


## Upgrade
Nextcloud 的 major 版本升級後需進入容器執行以下命令，用於升級 Nextcloud 和資料庫資料，minor、patch 版本升級後不需執行，log 如果有出現錯誤再執行即可。  
```bash
sudo -u www-data ./occ upgrade
sudo -u www-data ./occ db:add-missing-columns
sudo -u www-data ./occ db:add-missing-indices
sudo -u www-data ./occ db:add-missing-primary-keys
```


## License
Copyright (C) 2025  [hmes98318](https://github.com/hmes98318)  

Source: https://github.com/nextcloud/docker  

The custom Nextcloud image is licensed under the **GNU General Public License v3.0**, see the [LICENCE](./LICENSE) file for details.  
