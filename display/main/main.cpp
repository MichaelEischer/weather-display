#include "main.h"
#include <qrcode.h>
#include <nvs.h>
#include <nvs_flash.h>
#include <esp_sntp.h>
#include <SPI.h>

namespace ClockDisplay {

ClockDisplay& ClockDisplay::getInstance() {
    static ClockDisplay instance;
    return instance;
}

Error ClockDisplay::initialize() {
    // Initialize the Task Watchdog Timer (TWDT)
    esp_task_wdt_config_t config = {
        .timeout_ms = 360000,
        .idle_core_mask = 0,
        .trigger_panic = true
    };
    esp_task_wdt_init(&config);
    esp_task_wdt_add(NULL);

    initEpaper();
    
    Error err = initNvs();
    if (err != Error::NONE) {
        return err;
    }

    err = initWifi();
    if (err != Error::NONE) {
        return err;
    }

    initNtp();

    // Reconfigure watchdog with shorter timeout after WiFi is connected
    config.timeout_ms = 30000;
    esp_task_wdt_init(&config);

    return Error::NONE;
}

void ClockDisplay::initEpaper() {
    SPI.begin(TFT_SCLK, TFT_MISO, TFT_MOSI, -1);
    display_.epd2.selectSPI(SPI, SPISettings(SPI_FREQUENCY, MSBFIRST, TFT_SPI_MODE));
    display_.init(115200, true, 10, false);

    display_.setRotation(3);
    display_.clearScreen(GxEPD_WHITE);
    display_.fillScreen(GxEPD_WHITE);
    display_.hibernate();
}

Error ClockDisplay::initNvs() {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    if (ret != ESP_OK) {
        displayStatus("NVS Init Failed", ret);
        return Error::NVS_INIT_FAILED;
    }
    return Error::NONE;
}

Error ClockDisplay::initWifi() {
    displayStatus("Connecting to WiFi");
    generateApPassword();
    
    WiFiManager wifiManager;
    wifiManager.setConnectRetries(3);
    wifiManager.setConfigPortalTimeout(300);
    wifiManager.setCountry("DE");
    wifiManager.setAPCallback([this](WiFiManager* wm) { this->configModeCallback(wm); });
    
    if (!wifiManager.autoConnect(AP_NAME, apPassword_.c_str())) {
        displayStatus("Failed to connect to WiFi");
        return Error::WIFI_CONNECT_FAILED;
    }

    return Error::NONE;
}

void ClockDisplay::initNtp() {
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER1, NTP_SERVER2);
}

void ClockDisplay::displayStatus(const std::string& status, esp_err_t err) {
    display_.setFont(&FreeMonoBold9pt7b);
    display_.setTextColor(GxEPD_BLACK);
    display_.fillScreen(GxEPD_WHITE);

    int16_t tbx, tby;
    uint16_t tbw, tbh;
    display_.getTextBounds(status.c_str(), 0, 0, &tbx, &tby, &tbw, &tbh);
    uint16_t x = ((display_.width() - tbw) / 2) - tbx;
    uint16_t y = display_.height() / 2;

    display_.setCursor(x, y);
    display_.print(status.c_str());

    if (err != ESP_OK) {
        char err_msg[64];
        snprintf(err_msg, sizeof(err_msg), "Error: 0x%x\n%s", err, esp_err_to_name(err));

        display_.getTextBounds(err_msg, 0, 0, &tbx, &tby, &tbw, &tbh);
        x = ((display_.width() - tbw) / 2) - tbx;
        y += tbh + 10;

        display_.setCursor(x, y);
        display_.print(err_msg);
    }

    display_.display(true);
}

void ClockDisplay::generateApPassword() {
    apPassword_.resize(AP_PASSWORD_LENGTH);
    for (char& c : apPassword_) {
        c = 'a' + random(26);
    }
}

void ClockDisplay::configModeCallback(WiFiManager* wifiManager) {
    std::string status = "WIFI:S:" + std::string(AP_NAME) + ";T:WPA;P:" + apPassword_ + ";H:false;";
    drawQrcode(status);
}

void ClockDisplay::displayQrcode(esp_qrcode_handle_t qrcode) {
    constexpr int border = 2;
    constexpr int pixel_size = 4;
    int size = esp_qrcode_get_size(qrcode);
    
    int offset_x = display_.width() / 2 - size / 2 * pixel_size;
    int offset_y = display_.height() / 2 + 10 * pixel_size;

    for (int y = -border; y < size + border; y++) {
        for (int x = -border; x < size + border; x++) {
            uint16_t color = esp_qrcode_get_module(qrcode, x, y) ? GxEPD_BLACK : GxEPD_WHITE;
            display_.fillRect(x * pixel_size + offset_x, y * pixel_size + offset_y, 
                             pixel_size, pixel_size, color);
        }
    }
    display_.display(true);
}

void ClockDisplay::drawQrcode(const std::string& text) {
    esp_qrcode_config_t cfg = {
        .display_func = [](esp_qrcode_handle_t qrcode) {
            ClockDisplay::getInstance().displayQrcode(qrcode);
        },
        .max_qrcode_version = 10,
        .qrcode_ecc_level = ESP_QRCODE_ECC_LOW,
    };
    esp_qrcode_generate(&cfg, text.c_str());
}

void ClockDisplay::update() {
    while (true) {
        esp_task_wdt_reset();

        struct tm timeinfo;
        if (getLocalTime(&timeinfo)) {
            timeAvailable_ = true;
            time_t now = mktime(&timeinfo);
            
            if (lastUpdate_ == 0 || (now / 60) != (lastUpdate_ / 60)) {
                printLocalTime();
                display_.hibernate();
                lastUpdate_ = now;

                // Nightly full refresh to remove ghosting
                if (timeinfo.tm_hour == 3 && timeinfo.tm_min == 0) {
                    display_.display(false);
                }
            }
        } else if (timeAvailable_) {
            displayStatus("No time available");
            timeAvailable_ = false;
        }

        delay(10);
    }
}

void ClockDisplay::printLocalTime() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
        return;
    }

    display_.fillScreen(GxEPD_WHITE);
    display_.setFont(&NotoSans_Bold80pt7b);
    display_.setTextColor(GxEPD_BLACK);

    char timeStr[16];
    strftime(timeStr, sizeof(timeStr), "%H:%M", &timeinfo);

    int16_t tbx, tby;
    uint16_t tbw, tbh;
    display_.getTextBounds(timeStr, 0, 0, &tbx, &tby, &tbw, &tbh);
    uint16_t x = ((display_.width() - tbw) / 2) - tbx;
    uint16_t y = display_.height() / 2;

    display_.setCursor(x, y);
    display_.print(timeStr);
    display_.display(true);
}
} // namespace ClockDisplay

static void fatal_error() {
    while (true) {
        delay(1000);
    }
}

extern "C" void app_main() {
    initArduino();
    auto& display = ClockDisplay::ClockDisplay::getInstance();
    ClockDisplay::Error err = display.initialize();
    
    if (err != ClockDisplay::Error::NONE) {
        fatal_error();
    }
    
    display.update();
}
