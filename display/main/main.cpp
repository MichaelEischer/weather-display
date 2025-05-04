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

    // Generate a static AP password such that it doesn't change on each boot

    // Try to read the AP password from NVS
    nvs_handle_t nvs_handle;
    ret = nvs_open("storage", NVS_READWRITE, &nvs_handle);
    if (ret != ESP_OK) {
        displayStatus("NVS Open Failed", ret);
        return Error::NVS_INIT_FAILED;
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
            return Error::NVS_INIT_FAILED;
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
            return Error::NVS_INIT_FAILED;
        }
        
        // Commit the changes
        ret = nvs_commit(nvs_handle);
        if (ret != ESP_OK) {
            displayStatus("NVS Commit Failed", ret);
            nvs_close(nvs_handle);
            return Error::NVS_INIT_FAILED;
        }
    } else {
        displayStatus("NVS Error", ret);
        nvs_close(nvs_handle);
        return Error::NVS_INIT_FAILED;
    }

    nvs_close(nvs_handle);
    return Error::NONE;
}

Error ClockDisplay::initWifi() {
    displayStatus("Connecting to WiFi");
    
    WiFiManager wifiManager;
    wifiManager.setConnectRetries(3);
    wifiManager.setConfigPortalTimeout(300);
    wifiManager.setShowInfoUpdate(false);
    wifiManager.setCountry("DE");
    wifiManager.setAPCallback([this](WiFiManager* wm) { this->configModeCallback(wm); });
    
    if (!wifiManager.autoConnect(AP_NAME, apPassword_.c_str())) {
        displayStatus("WiFi setup failed");
        return Error::WIFI_CONNECT_FAILED;
    }

    return Error::NONE;
}

void ClockDisplay::initNtp() {
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER1, NTP_SERVER2);
}

void ClockDisplay::displayStatus(const std::string& status, esp_err_t err) {
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
}

void ClockDisplay::generateApPassword() {
    apPassword_.resize(AP_PASSWORD_LENGTH);
    for (char& c : apPassword_) {
        c = 'a' + random(26);
    }
}

uint16_t ClockDisplay::drawCenteredText(const std::string& text, int16_t y) {
    int16_t tbx, tby;
    uint16_t tbw, tbh;

    display_.getTextBounds(text.c_str(), 0, 0, &tbx, &tby, &tbw, &tbh);
    int16_t x = (display_.width() - tbw) / 2 - tbx;
    display_.setCursor(x, y);
    display_.print(text.c_str());
    return tbh;
}

void ClockDisplay::configModeCallback(WiFiManager* wifiManager) {
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
    std::string status = "WIFI:S:" + std::string(AP_NAME) + ";T:WPA;P:" + apPassword_ + ";H:false;";
    drawQrcode(status, center_x, center_y);

    display_.setFont(&FreeMonoBold12pt7b);

    // Draw AP name
    std::string ap_name = "SSID: " + std::string(AP_NAME);
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
}

// Initialize static members
int16_t ClockDisplay::qrCodeX_ = 0;
int16_t ClockDisplay::qrCodeY_ = 0;

void ClockDisplay::displayQrcode(esp_qrcode_handle_t qrcode, int16_t x, int16_t y) {
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

void ClockDisplay::drawQrcode(const std::string& text, int16_t x, int16_t y) {
    qrCodeX_ = x;
    qrCodeY_ = y;
    
    esp_qrcode_config_t cfg = {
        .display_func = [](esp_qrcode_handle_t qrcode) {
            ClockDisplay::getInstance().displayQrcode(qrcode, qrCodeX_, qrCodeY_);
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
                fetchAndDisplayDashboard();
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

void ClockDisplay::fetchAndDisplayDashboard() {
    if (downloadDashboard()) {
        displayDashboard();
    }
}

bool ClockDisplay::downloadDashboard() {
    HTTPClient http;
    http.begin(DASHBOARD_URL);
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
    if (width != DASHBOARD_WIDTH || height != DASHBOARD_HEIGHT) {
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
        size_t available = stream->available();
        if (available) {
            size_t read = stream->readBytes(dashboardBuffer_ + bytesRead, available);
            bytesRead += read;
        }
        if (!stream->connected()) {
            displayStatus("Stream disconnected");
            http.end();
            return false;
        }
        delay(1);
    }

    http.end();

    if (bytesRead != expectedSize) {
        displayStatus("Invalid PBM size");
        return false;
    }

    return true;
}

void ClockDisplay::displayDashboard() {
    // Calculate scaling factors to fit the display
    float scaleX = (float)display_.width() / DASHBOARD_WIDTH;
    float scaleY = (float)display_.height() / DASHBOARD_HEIGHT;
    float scale = std::min(scaleX, scaleY);

    // Calculate centered position
    int16_t x = (display_.width() - (DASHBOARD_WIDTH * scale)) / 2;
    int16_t y = (display_.height() - (DASHBOARD_HEIGHT * scale)) / 2;

    // Display the image
    display_.fillScreen(GxEPD_BLACK);
    display_.drawBitmap(x, y, dashboardBuffer_, DASHBOARD_WIDTH, DASHBOARD_HEIGHT, GxEPD_WHITE);
    display_.display(true);
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
