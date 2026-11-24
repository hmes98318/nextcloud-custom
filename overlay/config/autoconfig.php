<?php
// Pre-fills the data directory of the web installer. Nextcloud removes this
// file once the installation has finished.
$AUTOCONFIG = array(
  'directory' => '/var/www/html/nextclouddata',
);
