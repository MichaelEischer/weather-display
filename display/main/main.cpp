#include "main.h"
#include <esp_task_wdt.h>
#include <nvs_flash.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiManager.h>

#include <Fonts/FreeMonoBold12pt7b.h>
#include <Fonts/FreeMonoBold18pt7b.h>

namespace WeatherDisplay {

std::string getAPName() {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char macStr[5];
    snprintf(macStr, sizeof(macStr), "%02x%02x", mac[4], mac[5]);
    return std::string(AP_NAME_BASE) + "-" + std::string(macStr);
}

WeatherDisplay& WeatherDisplay::getInstance() {
    static WeatherDisplay instance;
    return instance;
}

Error WeatherDisplay::initialize() {
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

    err = initWifiPassword();
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

void WeatherDisplay::initEpaper() {
    SPI.begin(TFT_SCLK, TFT_MISO, TFT_MOSI, -1);
    display_.epd2.selectSPI(SPI, SPISettings(SPI_FREQUENCY, MSBFIRST, TFT_SPI_MODE));
    display_.init(115200, true, 10, false);

    display_.setRotation(3);
    display_.clearScreen(GxEPD_WHITE);
    display_.fillScreen(GxEPD_WHITE);
    display_.hibernate();
}

Error WeatherDisplay::initNvs() {
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

Error WeatherDisplay::initWifiPassword() {
    // Generate a static AP password such that it doesn't change on each boot

    // Try to read the AP password from NVS
    nvs_handle_t nvs_handle;
    esp_err_t ret = nvs_open("storage", NVS_READWRITE, &nvs_handle);
    if (ret != ESP_OK) {
        displayStatus("NVS Open Failed", ret);
        return Error::WIFI_PASSWORD_FAILED;
    }

    size_t required_size;
    ret = nvs_get_str(nvs_handle, "ap_password", nullptr, &required_size);
    if (ret == ESP_OK) {
        // Password exists in NVS, read it
        apPassword_.resize(required_size);
        ret = nvs_get_str(nvs_handle, "ap_password", &apPassword_[0], &required_size);
        if (ret != ESP_OK) {
            displayStatus("NVS Read Failed", ret);
            nvs_close(nvs_handle);
            return Error::WIFI_PASSWORD_FAILED;
        }
        // remove the null terminator
        apPassword_.resize(required_size - 1);
    } else if (ret == ESP_ERR_NVS_NOT_FOUND) {
        // Password doesn't exist, generate a new one
        generateApPassword();
        
        // Store the new password in NVS
        ret = nvs_set_str(nvs_handle, "ap_password", apPassword_.c_str());
        if (ret != ESP_OK) {
            displayStatus("NVS Write Failed", ret);
            nvs_close(nvs_handle);
            return Error::WIFI_PASSWORD_FAILED;
        }
        
        // Commit the changes
        ret = nvs_commit(nvs_handle);
        if (ret != ESP_OK) {
            displayStatus("NVS Commit Failed", ret);
            nvs_close(nvs_handle);
            return Error::WIFI_PASSWORD_FAILED;
        }
    } else {
        displayStatus("NVS Error", ret);
        nvs_close(nvs_handle);
        return Error::WIFI_PASSWORD_FAILED;
    }

    nvs_close(nvs_handle);
    return Error::NONE;
}

Error WeatherDisplay::initWifi() {
    displayStatus("Connecting to WiFi");
    
    WiFiManager wifiManager;
    wifiManager.setConnectRetries(3);
    wifiManager.setConfigPortalTimeout(300);
    wifiManager.setShowInfoUpdate(false);
    wifiManager.setCountry(AP_COUNTRY);
    wifiManager.setAPCallback([this](WiFiManager* wm) { this->configModeCallback(wm); });
    
    if (!wifiManager.autoConnect(getAPName().c_str(), apPassword_.c_str())) {
        displayStatus("WiFi setup failed");
        return Error::WIFI_CONNECT_FAILED;
    }

    return Error::NONE;
}

void WeatherDisplay::initNtp() {
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER1, NTP_SERVER2);
}

void WeatherDisplay::displayStatus(const std::string& status, esp_err_t err) {
    display_.setFont(&FreeMonoBold18pt7b);
    display_.setTextColor(GxEPD_BLACK);
    display_.fillScreen(GxEPD_WHITE);

    // Draw main status message
    int16_t error_y = display_.height() / 2;
    uint16_t tbh = drawCenteredText(status, error_y);

    if (err != ESP_OK) {
        char err_msg[64];
        snprintf(err_msg, sizeof(err_msg), "Error: 0x%x", err);
        error_y += tbh + 10;
        drawCenteredText(err_msg, error_y);

        error_y += tbh + 5;
        drawCenteredText(esp_err_to_name(err), error_y);
    }

    display_.display(true);
    display_.hibernate();
}

void WeatherDisplay::generateApPassword() {
    apPassword_.resize(AP_PASSWORD_LENGTH);
    for (char& c : apPassword_) {
        c = 'a' + random(26);
    }
}

uint16_t WeatherDisplay::drawCenteredText(const std::string& text, int16_t y) {
    int16_t tbx, tby;
    uint16_t tbw, tbh;

    display_.getTextBounds(text.c_str(), 0, 0, &tbx, &tby, &tbw, &tbh);
    int16_t x = (display_.width() - tbw) / 2 - tbx;
    display_.setCursor(x, y);
    display_.print(text.c_str());
    return tbh;
}

void WeatherDisplay::configModeCallback(WiFiManager* wifiManager) {
    display_.fillScreen(GxEPD_WHITE);
    display_.setFont(&FreeMonoBold18pt7b);
    display_.setTextColor(GxEPD_BLACK);

    // Calculate center positions
    int16_t center_x = display_.width() / 2;
    int16_t center_y = display_.height() / 2;

    // Draw "Scan to setup WiFi" text
    const char* title = "Scan to setup WiFi";
    int16_t title_y = 40; // Top margin
    uint16_t tbh = drawCenteredText(title, title_y);

    // Draw QR code
    std::string status = "WIFI:S:" + getAPName() + ";T:WPA;P:" + apPassword_ + ";H:false;";
    drawQrcode(status, center_x, center_y);

    display_.setFont(&FreeMonoBold12pt7b);

    // Draw AP name
    std::string ap_name = "SSID: " + getAPName();
    int16_t ap_y = center_y + 120; // Below QR code
    tbh = drawCenteredText(ap_name, ap_y);
    
    // Draw password
    std::string ap_pass = "Pass: " + apPassword_;
    ap_y += tbh + 5; // Small gap between lines
    tbh = drawCenteredText(ap_pass, ap_y);

    // Draw IP address
    const char* ip = "http://192.168.4.1";
    int16_t ip_y = ap_y + tbh + 10; // Below AP info
    tbh = drawCenteredText(ip, ip_y);

    display_.display(true);
    display_.hibernate();
}

// Initialize static members
int16_t WeatherDisplay::qrCodeX_ = 0;
int16_t WeatherDisplay::qrCodeY_ = 0;

void WeatherDisplay::displayQrcode(esp_qrcode_handle_t qrcode, int16_t x, int16_t y) {
    constexpr int border = 2;
    constexpr int pixel_size = 4;
    int size = esp_qrcode_get_size(qrcode);
    
    // Calculate the total size including border and pixel size
    int total_size = (size + 2 * border) * pixel_size;
    
    // Calculate the offset to center the QR code on the given coordinates
    int16_t offset_x = x - total_size / 2;
    int16_t offset_y = y - total_size / 2;
    
    for (int y_pos = -border; y_pos < size + border; y_pos++) {
        for (int x_pos = -border; x_pos < size + border; x_pos++) {
            uint16_t color = esp_qrcode_get_module(qrcode, x_pos, y_pos) ? GxEPD_BLACK : GxEPD_WHITE;
            display_.fillRect(x_pos * pixel_size + offset_x, y_pos * pixel_size + offset_y, 
                             pixel_size, pixel_size, color);
        }
    }
}

void WeatherDisplay::drawQrcode(const std::string& text, int16_t x, int16_t y) {
    qrCodeX_ = x;
    qrCodeY_ = y;
    
    esp_qrcode_config_t cfg = {
        .display_func = [](esp_qrcode_handle_t qrcode) {
            WeatherDisplay::getInstance().displayQrcode(qrcode, qrCodeX_, qrCodeY_);
        },
        .max_qrcode_version = 10,
        .qrcode_ecc_level = ESP_QRCODE_ECC_LOW,
    };
    esp_qrcode_generate(&cfg, text.c_str());
}

void WeatherDisplay::update() {
    // set to true to enter the fallback path if time is not available
    bool timeAvailable = true;
    time_t lastUpdate = 0;
    while (true) {
        esp_task_wdt_reset();

        struct tm timeinfo;
        if (getLocalTime(&timeinfo)) {
            timeAvailable = true;
            time_t now = mktime(&timeinfo);
            
            if (lastUpdate == 0 || (now / 60) != (lastUpdate / 60)) {
                fetchAndDisplayDashboard();
                lastUpdate = now;

                // Nightly full refresh to remove ghosting
                if (timeinfo.tm_hour == 3 && timeinfo.tm_min == 0) {
                    display_.display(false);
                    display_.hibernate();
                }
            }
        } else if (timeAvailable) {
            displayStatus("No time available");
            timeAvailable = false;
        }

        delay(1000);
    }
}

void WeatherDisplay::fetchAndDisplayDashboard() {
    if (downloadDashboard()) {
        displayDashboard();
    }
}

bool WeatherDisplay::downloadDashboard() {
    HTTPClient http;
    http.begin(String("http://")+DASHBOARD_SERVER+"/dashboard.pbm");
    // 10 seconds timeout. The dashboard takes roughly 1 second to render on the server.
    http.setTimeout(10000);
    
    int httpCode = http.GET();
    if (httpCode != HTTP_CODE_OK) {
        char statusMsg[64];
        snprintf(statusMsg, sizeof(statusMsg), "Dashboard download failed: %d", httpCode);
        displayStatus(statusMsg);
        http.end();
        return false;
    }

    // Read PBM header
    WiFiClient* stream = http.getStreamPtr();
    char header[64];
    size_t headerLen = stream->readBytesUntil('\n', header, sizeof(header) - 1);
    header[headerLen] = '\0';
    
    // Verify PBM magic number
    if (strncmp(header, "P4", 2) != 0) {
        displayStatus("Invalid PBM format");
        http.end();
        return false;
    }

    // Skip comments
    while (true) {
        headerLen = stream->readBytesUntil('\n', header, sizeof(header) - 1);
        header[headerLen] = '\0';
        if (header[0] != '#') break;
    }

    // Parse dimensions
    int width, height;
    if (sscanf(header, "%d %d", &width, &height) != 2) {
        displayStatus("Invalid PBM dimensions");
        http.end();
        return false;
    }

    // Verify dimensions match expected size
    if (width != display_.width() || height != display_.height()) {
        char statusMsg[64];
        snprintf(statusMsg, sizeof(statusMsg), "Invalid size: %dx%d", width, height);
        displayStatus(statusMsg);
        http.end();
        return false;
    }

    // Calculate expected size (PBM is 1 bit per pixel, packed into bytes)
    size_t expectedSize = (width * height + 7) / 8;

    // Allocate buffer for the PBM data
    if (dashboardBuffer_ == nullptr || dashboardBufferSize_ < expectedSize) {
        if (dashboardBuffer_ != nullptr) {
            free(dashboardBuffer_);
        }
        dashboardBuffer_ = (uint8_t*)malloc(expectedSize);
        if (dashboardBuffer_ == nullptr) {
            displayStatus("Memory allocation failed");
            http.end();
            return false;
        }
        dashboardBufferSize_ = expectedSize;
    }

    // Download the PBM data
    size_t bytesRead = 0;
    while (bytesRead < expectedSize) {
        if (!stream->connected()) {
            displayStatus("Stream disconnected");
            http.end();
            return false;
        }
        size_t available = stream->available();
        if (available) {
            size_t read = stream->readBytes(dashboardBuffer_ + bytesRead, available);
            bytesRead += read;
        } else {
            delay(1);
        }
    }

    http.end();

    if (bytesRead != expectedSize) {
        displayStatus("Invalid PBM size");
        return false;
    }

    // Calculate hash of the new dashboard content
    // A simple hash function is good enough
    uint32_t newHash = 0;
    for (size_t i = 0; i < expectedSize; i++) {
        newHash = (newHash * 31) + dashboardBuffer_[i];
    }

    // Only update if the content has changed
    if (newHash != currentDashboardHash_) {
        currentDashboardHash_ = newHash;
        return true;
    }

    return false;
}

void WeatherDisplay::displayDashboard() {
    // Display the image. 1 = black, 0 = white.
    display_.fillScreen(GxEPD_WHITE);
    // only sets the pixels that have 1 in the buffer
    display_.drawBitmap(0, 0, dashboardBuffer_, display_.width(), display_.height(), GxEPD_BLACK);
    display_.display(true);
    display_.hibernate();
}
} // namespace ClockDisplay

static void fatal_error() {
    while (true) {
        delay(1000);
    }
}

extern "C" void app_main() {
    initArduino();
    auto& display = WeatherDisplay::WeatherDisplay::getInstance();
    WeatherDisplay::Error err = display.initialize();
    
    if (err != WeatherDisplay::Error::NONE) {
        fatal_error();
    }
    
    display.update();
}
