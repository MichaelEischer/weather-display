#include "Arduino.h"
#include "pins_arduino.h"
#include <GxEPD2_BW.h>
#include <GxEPD2_426_GDEQ0426T82Mod.h>
#include <Fonts/FreeMonoBold9pt7b.h>
#include <qrcode.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include "nvs.h"
#include "nvs_flash.h"
#include <esp_err.h>
#include <esp_system.h>
#include <time.h>
#include <esp_sntp.h>

#include "Fonts/NotoSansBold80pt7b.h"

#define TFT_SCLK D8
// not really, the pin is not connected. But the library seems to fall apart without it.
#define TFT_MISO D9
#define TFT_MOSI D10
#define TFT_CS D1 // Chip select control pin
#define TFT_DC D3 // Data Command control pin
#define TFT_BUSY D2
#define TFT_RST D0 // Reset pin (could connect to RST pin)

#define SPI_FREQUENCY 10000000
#define TFT_SPI_MODE SPI_MODE0

// Create a global SPI instance
SPIClass spi = SPIClass(FSPI);

GxEPD2_BW<GxEPD2_426_GDEQ0426T82Mod, GxEPD2_426_GDEQ0426T82Mod::HEIGHT> display(GxEPD2_426_GDEQ0426T82Mod(
  TFT_CS, TFT_DC, TFT_RST, TFT_BUSY)); // GDEQ0426T82 480x800, SSD1677 (P426010-MF1-A)

const char *ntpServer1 = "0.de.pool.ntp.org";
const char *ntpServer2 = "1.de.pool.ntp.org";
const long gmtOffset_sec = 3600;
const int daylightOffset_sec = 3600;

void display_status(const char* status, esp_err_t err = ESP_OK) {
  display.setFont(&FreeMonoBold9pt7b);
  display.setTextColor(GxEPD_BLACK);

  // Clear the display
  display.fillScreen(GxEPD_WHITE);

  // Calculate text position for center alignment
  int16_t tbx, tby;
  uint16_t tbw, tbh;
  display.getTextBounds(status, 0, 0, &tbx, &tby, &tbw, &tbh);
  uint16_t x = ((display.width() - tbw) / 2) - tbx;
  uint16_t y = display.height() / 2;

  // Display the status
  display.setCursor(x, y);
  display.print(status);

  // If there's an error, display the error code and description
  if (err != ESP_OK) {
    char err_msg[64];
    snprintf(err_msg, sizeof(err_msg), "Error: 0x%x\n%s", err, esp_err_to_name(err));

    display.getTextBounds(err_msg, 0, 0, &tbx, &tby, &tbw, &tbh);
    x = ((display.width() - tbw) / 2) - tbx;
    y += tbh + 10; // Add some spacing between messages

    display.setCursor(x, y);
    display.print(err_msg);
  }

  display.display(true);
}

void fatal_error() {
  while (true) {
    delay(1000);
  }
}

void display_qrcode(esp_qrcode_handle_t qrcode) {
  int size = esp_qrcode_get_size(qrcode);
  int border = 2;

  int pixel_size = 4;
  int offset_x = display.width() / 2 - size / 2 * pixel_size;
  int offset_y = display.height() / 2 + 10*pixel_size;

  for (int y = -border; y < size + border; y++) {
      for (int x = -border; x < size + border; x++) {
          uint16_t color = esp_qrcode_get_module(qrcode, x, y) ? GxEPD_BLACK : GxEPD_WHITE;
          display.fillRect(x * pixel_size + offset_x, y * pixel_size + offset_y, pixel_size, pixel_size, color);
      }
  }
  display.display(true);
}

void draw_qrcode(const char* text) {
  esp_qrcode_config_t cfg = {
    .display_func = display_qrcode,
    .max_qrcode_version = 10,
    .qrcode_ecc_level = ESP_QRCODE_ECC_LOW,
  };
  esp_qrcode_generate(&cfg, text);
}

const char* AP_NAME = "esp-clock";
char apPassword[11];

void generate_ap_password() {
  // set apPassword to a random password with 10 characters
  for (int i = 0; i < sizeof(apPassword)-1; i++) {
    apPassword[i] = 'a' + random(26);
  }
  apPassword[sizeof(apPassword)-1] = '\0';
}

void configModeCallback (WiFiManager *myWiFiManager) {
    char status[100];
    snprintf(status, sizeof(status), "WIFI:S:%s;T:WPA;P:%s;H:false;", AP_NAME, apPassword);
    draw_qrcode(status);
}

void init_wifi() {
  display_status("Connecting to WiFi");
  generate_ap_password();
  WiFiManager wifiManager;
  wifiManager.setConnectRetries(3);
  wifiManager.setConfigPortalTimeout(300);
  wifiManager.setCountry("DE");
  wifiManager.setAPCallback(configModeCallback);
  if (!wifiManager.autoConnect(AP_NAME, apPassword)) {
    display_status("Failed to connect to WiFi");
    fatal_error();
  }
}

void init_nvs() {
  esp_err_t ret = nvs_flash_init();
  if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    ret = nvs_flash_init();
  }
  if (ret != ESP_OK) {
    display_status("NVS Init Failed", ret);
    fatal_error();
  }
}

void init_epaper() {
  // Initialize SPI with correct pins
  spi.begin(TFT_SCLK, TFT_MISO, TFT_MOSI, -1);
  display.epd2.selectSPI(spi, SPISettings(SPI_FREQUENCY, MSBFIRST, TFT_SPI_MODE));
  display.init(115200, true, 10, false);

  display.setRotation(3);
  display.clearScreen(GxEPD_WHITE);
  display.fillScreen(GxEPD_WHITE);
  display.hibernate();
}

void init_ntp() {
  // Configure NTP
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer1, ntpServer2);
}

void setup()
{
  init_epaper();
  init_wifi();
  init_ntp();
}

void printLocalTime() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return;
  }

  // Clear the display
  display.fillScreen(GxEPD_WHITE);

  // Set the font to NotoSans_Bold80pt7b
  display.setFont(&NotoSans_Bold80pt7b);
  display.setTextColor(GxEPD_BLACK);

  // Format time string
  char timeStr[16];
  strftime(timeStr, sizeof(timeStr), "%H:%M", &timeinfo);

  // Calculate text position for center alignment
  int16_t tbx, tby;
  uint16_t tbw, tbh;
  display.getTextBounds(timeStr, 0, 0, &tbx, &tby, &tbw, &tbh);
  uint16_t x = ((display.width() - tbw) / 2) - tbx;
  uint16_t y = display.height() / 2;

  // Display the time
  display.setCursor(x, y);
  display.print(timeStr);

  // Update the display
  display.display(true);
}

void loop() {
  time_t last_update = 0;
  bool time_available = true;
  
  while(true) {
    struct tm timeinfo;
  
    if (getLocalTime(&timeinfo)) {
      time_available = true;
      time_t now = mktime(&timeinfo);
      
      // Update if it's a new minute or if we haven't updated yet
      if (last_update == 0 || (now / 60) != (last_update / 60)) {
        printLocalTime();
        display.hibernate();
        last_update = now;
      }
    } else if (time_available) {
      display_status("No time available");
      time_available = false;
    }

    delay(10); // Check with high frequency
  }
}

extern "C" void app_main()
{
  initArduino();
  setup();

  loop();
}
