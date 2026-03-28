#include "UserService.h"
#include "Logger.h"
#include <stdexcept>
#include <regex>

namespace app {

UserService::UserService(UserRepository& repo) : m_repo(repo) {}

User UserService::createUser(const std::string& name, const std::string& email) {
    validateOrThrow(name, email);

    int nextId = m_repo.countUsers() + 1;
    User newUser(nextId, name, email);
    m_repo.addUser(newUser);

    Logger::instance().info("Created user: " + newUser.toString());
    return newUser;
}

std::optional<User> UserService::getUser(int id) const {
    auto user = m_repo.findById(id);
    if (!user) {
        Logger::instance().warning("User not found: id=" + std::to_string(id));
    }
    return user;
}

bool UserService::deactivateUser(int id) {
    auto user = m_repo.findById(id);
    if (!user) {
        Logger::instance().warning("Cannot deactivate: user not found id=" + std::to_string(id));
        return false;
    }

    User updated = *user;
    updated.setActive(false);
    bool success = m_repo.updateUser(id, updated);

    if (success) {
        Logger::instance().info("Deactivated user: id=" + std::to_string(id));
    }
    return success;
}

bool UserService::changeEmail(int id, const std::string& newEmail) {
    if (!isValidEmail(newEmail)) {
        throw std::invalid_argument("Invalid email format: " + newEmail);
    }

    auto user = m_repo.findById(id);
    if (!user) {
        return false;
    }

    User updated = *user;
    updated.setEmail(newEmail);
    return m_repo.updateUser(id, updated);
}

bool UserService::isValidEmail(const std::string& email) {
    static const std::regex emailRegex(R"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})");
    return std::regex_match(email, emailRegex);
}

bool UserService::isValidName(const std::string& name) {
    return !name.empty() && name.length() <= 100;
}

int UserService::getActiveUserCount() const {
    return static_cast<int>(m_repo.getActiveUsers().size());
}

int UserService::getTotalUserCount() const {
    return m_repo.countUsers();
}

void UserService::validateOrThrow(const std::string& name, const std::string& email) const {
    if (!isValidName(name)) {
        throw std::invalid_argument("Invalid name: must be 1-100 characters");
    }
    if (!isValidEmail(email)) {
        throw std::invalid_argument("Invalid email format: " + email);
    }
}

} // namespace app
