#pragma once

#include "Arduino.h"
#include "pins_arduino.h"
#include <memory>
#include <string>
#include <ctime>
#include <GxEPD2_BW.h>
#include <GxEPD2_426_GDEQ0426T82Mod.h>
#include <Fonts/FreeMonoBold12pt7b.h>
#include <Fonts/FreeMonoBold18pt7b.h>
#include <Fonts/NotoSansBold80pt7b.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <esp_err.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <qrcode.h>
#include <HTTPClient.h>

namespace ClockDisplay {

// Constants
constexpr auto NTP_SERVER1 = "0.de.pool.ntp.org";
constexpr auto NTP_SERVER2 = "1.de.pool.ntp.org";
constexpr auto GMT_OFFSET_SEC = 3600;
constexpr auto DAYLIGHT_OFFSET_SEC = 3600;
constexpr auto AP_NAME = "esp-clock";
constexpr auto AP_PASSWORD_LENGTH = 10;
constexpr auto DASHBOARD_URL = "http://192.168.178.202:3000/dashboard.pbm";
constexpr auto DASHBOARD_REFRESH_INTERVAL = 60000; // 1 minute in milliseconds
constexpr auto DASHBOARD_WIDTH = 480;  // Width of the dashboard in pixels
constexpr auto DASHBOARD_HEIGHT = 800; // Height of the dashboard in pixels

// Pin definitions
constexpr auto TFT_SCLK = D8;
constexpr auto TFT_MISO = D9;
constexpr auto TFT_MOSI = D10;
constexpr auto TFT_CS = D1;
constexpr auto TFT_DC = D3;
constexpr auto TFT_BUSY = D2;
constexpr auto TFT_RST = D0;
constexpr auto SPI_FREQUENCY = 10000000;
constexpr auto TFT_SPI_MODE = SPI_MODE0;

// Error codes
enum class Error {
    NONE = 0,
    NVS_INIT_FAILED,
    WIFI_CONNECT_FAILED
};

class ClockDisplay {
public:
    static ClockDisplay& getInstance();

    Error initialize();
    void update();

private:
    ClockDisplay() : display_(GxEPD2_426_GDEQ0426T82Mod(TFT_CS, TFT_DC, TFT_RST, TFT_BUSY)) {}
    ~ClockDisplay() = default;
    ClockDisplay(const ClockDisplay&) = delete;
    ClockDisplay& operator=(const ClockDisplay&) = delete;

    void initEpaper();
    Error initWifi();
    void initNtp();
    Error initNvs();

    void displayStatus(const std::string& status, esp_err_t err = ESP_OK);
    void printLocalTime();
    void generateApPassword();
    void configModeCallback(WiFiManager* wifiManager);

    // QR code related methods
    void displayQrcode(esp_qrcode_handle_t qrcode, int16_t x, int16_t y);
    void drawQrcode(const std::string& text, int16_t x, int16_t y);

    // Dashboard related methods
    void fetchAndDisplayDashboard();
    bool downloadDashboard();
    void displayDashboard();

    // Helper method for drawing centered text
    // Returns the text height for vertical spacing calculations
    uint16_t drawCenteredText(const std::string& text, int16_t y);

    GxEPD2_BW<GxEPD2_426_GDEQ0426T82Mod, GxEPD2_426_GDEQ0426T82Mod::HEIGHT> display_;
    std::string apPassword_;
    time_t lastUpdate_ = 0;
    bool timeAvailable_ = true;
    uint8_t* dashboardBuffer_ = nullptr;
    size_t dashboardBufferSize_ = 0;
    bool dashboardChanged_ = false;

    // Static variables for QR code coordinates
    static int16_t qrCodeX_;
    static int16_t qrCodeY_;
};

} // namespace ClockDisplay
