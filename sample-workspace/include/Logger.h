#pragma once
#include <string>
#include <fstream>
#include <mutex>

namespace app {

/**
 * Simple thread-safe logger with severity levels.
 */
enum class LogLevel {
    DEBUG,
    INFO,
    WARNING,
    ERROR
};

class Logger {
public:
    static Logger& instance();

    void setLevel(LogLevel level);
    void setOutputFile(const std::string& filePath);

    void debug(const std::string& message);
    void info(const std::string& message);
    void warning(const std::string& message);
    void error(const std::string& message);

private:
    Logger();
    ~Logger();
    Logger(const Logger&) = delete;
    Logger& operator=(const Logger&) = delete;

    void log(LogLevel level, const std::string& message);
    std::string levelToString(LogLevel level) const;
    std::string timestamp() const;

    LogLevel m_level;
    std::ofstream m_file;
    std::mutex m_mutex;
    bool m_useFile;
};

} // namespace app
