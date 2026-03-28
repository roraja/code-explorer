#include "Logger.h"
#include <iostream>
#include <chrono>
#include <iomanip>
#include <sstream>

namespace app {

Logger& Logger::instance() {
    static Logger instance;
    return instance;
}

Logger::Logger() : m_level(LogLevel::INFO), m_useFile(false) {}

Logger::~Logger() {
    if (m_file.is_open()) {
        m_file.close();
    }
}

void Logger::setLevel(LogLevel level) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_level = level;
}

void Logger::setOutputFile(const std::string& filePath) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_file.is_open()) {
        m_file.close();
    }
    m_file.open(filePath, std::ios::app);
    m_useFile = m_file.is_open();
}

void Logger::debug(const std::string& message) {
    log(LogLevel::DEBUG, message);
}

void Logger::info(const std::string& message) {
    log(LogLevel::INFO, message);
}

void Logger::warning(const std::string& message) {
    log(LogLevel::WARNING, message);
}

void Logger::error(const std::string& message) {
    log(LogLevel::ERROR, message);
}

void Logger::log(LogLevel level, const std::string& message) {
    if (level < m_level) {
        return;
    }

    std::lock_guard<std::mutex> lock(m_mutex);
    std::string formatted = timestamp() + " [" + levelToString(level) + "] " + message;

    if (m_useFile) {
        m_file << formatted << std::endl;
    } else {
        if (level >= LogLevel::WARNING) {
            std::cerr << formatted << std::endl;
        } else {
            std::cout << formatted << std::endl;
        }
    }
}

std::string Logger::levelToString(LogLevel level) const {
    switch (level) {
        case LogLevel::DEBUG:   return "DEBUG";
        case LogLevel::INFO:    return "INFO";
        case LogLevel::WARNING: return "WARN";
        case LogLevel::ERROR:   return "ERROR";
        default:                return "UNKNOWN";
    }
}

std::string Logger::timestamp() const {
    auto now = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    std::ostringstream oss;
    oss << std::put_time(std::localtime(&time), "%Y-%m-%d %H:%M:%S");
    return oss.str();
}

} // namespace app
