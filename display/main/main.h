#pragma once

#include <string>
#include <GxEPD2_BW.h>
#include <GxEPD2_426_GDEQ0426T82Mod.h>
#include <esp_err.h>
#include <qrcode.h>

#include "board.h"

// Forward declaration of WiFiManager class
class WiFiManager;

namespace WeatherDisplay {

// Constants
constexpr auto AP_NAME_BASE = "esp-weather";
constexpr auto AP_PASSWORD_LENGTH = 10;
constexpr auto AP_COUNTRY = "DE";

constexpr auto NTP_SERVER1 = "0.de.pool.ntp.org";
constexpr auto NTP_SERVER2 = "1.de.pool.ntp.org";
constexpr auto GMT_OFFSET_SEC = 3600;
constexpr auto DAYLIGHT_OFFSET_SEC = 3600;

constexpr auto DASHBOARD_SERVER = "192.168.178.202:3000";
constexpr auto DASHBOARD_REFRESH_INTERVAL = 60000; // 1 minute in milliseconds

// Error codes
enum class Error {
    NONE = 0,
    NVS_INIT_FAILED,
    WIFI_CONNECT_FAILED,
    WIFI_PASSWORD_FAILED
};

class WeatherDisplay {
public:
    static WeatherDisplay& getInstance();

    Error initialize();
    void update();

private:
    WeatherDisplay() : display_(GxEPD2_426_GDEQ0426T82Mod(TFT_CS, TFT_DC, TFT_RST, TFT_BUSY)) {}
    ~WeatherDisplay() = default;
    WeatherDisplay(const WeatherDisplay&) = delete;
    WeatherDisplay& operator=(const WeatherDisplay&) = delete;

    void initEpaper();
    Error initNvs();
    Error initWifiPassword();
    Error initWifi();
    void initNtp();

    void displayStatus(const std::string& status, esp_err_t err = ESP_OK);
    void generateApPassword();
    void configModeCallback(WiFiManager* wifiManager);

    // QR code related methods
    void displayQrcode(esp_qrcode_handle_t qrcode, int16_t x, int16_t y);
    void drawQrcode(const std::string& text, int16_t x, int16_t y);

    // update loop helpers
    void waitNextSecond();

    // Dashboard related methods
    void fetchAndDisplayDashboard();
    bool downloadDashboard();
    void displayDashboard();

    // Helper method for drawing centered text
    // Returns the text height for vertical spacing calculations
    uint16_t drawCenteredText(const std::string& text, int16_t y);

    GxEPD2_BW<GxEPD2_426_GDEQ0426T82Mod, GxEPD2_426_GDEQ0426T82Mod::HEIGHT> display_;
    std::string apPassword_;
    uint8_t* dashboardBuffer_ = nullptr;
    size_t dashboardBufferSize_ = 0;
    uint32_t currentDashboardHash_ = 0;
    uint32_t identicalDraws_ = 0;

    // Static variables for QR code coordinates
    static int16_t qrCodeX_;
    static int16_t qrCodeY_;
};

} // namespace WeatherDisplay
