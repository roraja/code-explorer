#include "UserRepository.h"
#include <algorithm>

namespace app {

UserRepository::UserRepository() : m_nextId(1) {}

void UserRepository::addUser(const User& user) {
    m_users.push_back(user);
}

std::optional<User> UserRepository::findById(int id) const {
    auto it = findConstIterator(id);
    if (it != m_users.end()) {
        return *it;
    }
    return std::nullopt;
}

std::vector<User> UserRepository::findByName(const std::string& nameQuery) const {
    std::vector<User> results;
    for (const auto& user : m_users) {
        if (user.getName().find(nameQuery) != std::string::npos) {
            results.push_back(user);
        }
    }
    return results;
}

bool UserRepository::updateUser(int id, const User& updated) {
    auto it = findIterator(id);
    if (it != m_users.end()) {
        *it = updated;
        return true;
    }
    return false;
}

bool UserRepository::removeUser(int id) {
    auto it = findIterator(id);
    if (it != m_users.end()) {
        m_users.erase(it);
        return true;
    }
    return false;
}

std::vector<User> UserRepository::getAllUsers() const {
    return m_users;
}

std::vector<User> UserRepository::getActiveUsers() const {
    return filter([](const User& u) { return u.isActive(); });
}

int UserRepository::countUsers() const {
    return static_cast<int>(m_users.size());
}

std::vector<User> UserRepository::filter(
    std::function<bool(const User&)> predicate) const {
    std::vector<User> results;
    std::copy_if(m_users.begin(), m_users.end(),
                 std::back_inserter(results), predicate);
    return results;
}

std::vector<User>::iterator UserRepository::findIterator(int id) {
    return std::find_if(m_users.begin(), m_users.end(),
                        [id](const User& u) { return u.getId() == id; });
}

std::vector<User>::const_iterator UserRepository::findConstIterator(int id) const {
    return std::find_if(m_users.begin(), m_users.end(),
                        [id](const User& u) { return u.getId() == id; });
}

} // namespace app
