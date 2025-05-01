#include "Arduino.h"
#include "pins_arduino.h"
#include <GxEPD2_BW.h>
#include <GxEPD2_426_GDEQ0426T82Mod.h>
#include <Fonts/FreeMonoBold9pt7b.h>
#include <qrcode.h>
#include <WiFi.h>
#include "nvs.h"
#include "nvs_flash.h"
#include <esp_err.h>

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

void init_wifi() {
  // Initialize NVS
  esp_err_t ret = nvs_flash_init();
  if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    ret = nvs_flash_init();
  }
  if (ret != ESP_OK) {
    display_status("NVS Init Failed", ret);
    ESP_ERROR_CHECK(ret);
    return;
  }

  // Open NVS
  nvs_handle_t nvs_handle;
  ret = nvs_open("storage", NVS_READONLY, &nvs_handle);
  if (ret != ESP_OK) {
    display_status("NVS Open Failed", ret);
    return;
  }

  // Read WiFi credentials from NVS
  char wifi_ssid[32] = {0};
  char wifi_password[64] = {0};
  size_t ssid_size = sizeof(wifi_ssid);
  size_t password_size = sizeof(wifi_password);

  ret = nvs_get_str(nvs_handle, "wifi_ssid", wifi_ssid, &ssid_size);
  if (ret != ESP_OK) {
    display_status("WiFi SSID Read Failed", ret);
    nvs_close(nvs_handle);
    return;
  }

  ret = nvs_get_str(nvs_handle, "wifi_password", wifi_password, &password_size);
  if (ret != ESP_OK) {
    display_status("WiFi Password Read Failed", ret);
    nvs_close(nvs_handle);
    return;
  }

  nvs_close(nvs_handle);

  // Initialize WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifi_ssid, wifi_password);
  
  // Wait for connection with visual feedback
  int dots = 0;
  int iteration = 0;
  while (WiFi.status() != WL_CONNECTED) {
    if (iteration % 20 == 0) {
      dots = (dots + 1) % 4;
      char status[32];
      snprintf(status, sizeof(status), "Connecting%s %d", "...." + (3 - dots), WiFi.status());
      display_status(status);
    }
    iteration++;
    delay(500);

    if (dots > 3) {
      display_status("Failed to connect to WiFi");
      return;
    }
  }
  
  // Show final status
  char ip_status[64];
  snprintf(ip_status, sizeof(ip_status), "Connected!\nIP: %s", WiFi.localIP().toString().c_str());
  display_status(ip_status);
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

void setup()
{
  init_epaper();
  init_wifi();
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

const char HelloWorld[] = "Hello World!";

void loop() {
  display.setFont(&FreeMonoBold9pt7b);
  display.setTextColor(GxEPD_BLACK);
  delay(10000);
  
  draw_qrcode(HelloWorld);

  int16_t tbx, tby; uint16_t tbw, tbh;
  display.getTextBounds(HelloWorld, 0, 0, &tbx, &tby, &tbw, &tbh);
  // center the bounding box by transposition of the origin:
  uint16_t x = ((display.width() - tbw) / 2) - tbx;
  // uint16_t y = ((display.height() - tbh) / 2) - tby;

  for (int i = 0 ; i < 50; i++) {
    display.fillRect(0, 0, display.width(), display.height()/2, GxEPD_WHITE);
    display.setCursor(x, i * 10 + 20);
    display.print(HelloWorld);
    display.display(true);
    display.hibernate();

    delay(10000);
  }
};

extern "C" void app_main()
{
  initArduino();

  setup();

  // Arduino-like loop()
  while(true){
    loop();
  }

  // WARNING: if program reaches end of function app_main() the MCU will restart.
}
