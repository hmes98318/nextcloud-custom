<?php
// Nextcloud settings that only the test environment needs.
//
// Nextcloud loads every config/*.config.php file after config.php and lets
// later files win, so these values override what the web installer wrote.
// Keep this file minimal: a setting here hides that behavior from the tests.
$CONFIG = array(
  // Server-side requests, such as the HTTP checks of the admin Overview and
  // cron, must reach nginx on the HTTPS port inside the container. The host
  // reaches it through a random published port, which is not valid in there.
  'overwrite.cli.url' => 'https://localhost',

  // The tests must not depend on the internet. Without this, cron.php waits
  // for update, subscription, and federation servers and takes minutes.
  'has_internet_connection' => false,
  'updatechecker' => false,

  // Clear the setup warnings about options that every administrator chooses
  // for themselves and that do not concern the image.
  'default_phone_region' => 'TW',
  'maintenance_window_start' => 1,
);
