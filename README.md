# nextcloud-custom
基於 Nextcloud 官方 image 修改的容器  
修改成自託管 Nextcloud server 所需架構，進行配置優化。  
並部署於地端 Kubernetes 集群上。  

- **Web 服務**：使用 Nginx + PHP-FPM
- **資料庫**：連接外部的 MariaDB, Redis 
- **存儲**：Nextcloud data 使用 NFS 掛載外部存儲 server (TrueNAS CORE)
- **檔案限制**：修改最大檔案上傳大小至 100GB
- **網頁載入優化**：優化 Nginx 配置，啟用 Brotli、gzip 壓縮，提高網頁載入速度
- **SSL**：優化 Nginx SSL 配置，提高安全性。


## Upgrade
Nextcloud 版本升級後，需進入容器內執行以下命令：
```bash
nextcloud-upgrade
```
此腳本會執行 Nextcloud 升級腳本、檢查並更新資料庫欄位、索引。


## License
Copyright (C) 2025  [hmes98318](https://github.com/hmes98318)  

Source: https://github.com/nextcloud/docker  

The custom Nextcloud image is licensed under the **GNU General Public License v3.0**, see the [LICENCE](./LICENSE) file for details.  
