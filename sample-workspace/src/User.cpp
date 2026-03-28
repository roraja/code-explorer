#include "User.h"
#include <sstream>

namespace app {

User::User(int id, const std::string& name, const std::string& email)
    : m_id(id), m_name(name), m_email(email), m_active(true) {}

int User::getId() const { return m_id; }
std::string User::getName() const { return m_name; }
std::string User::getEmail() const { return m_email; }
bool User::isActive() const { return m_active; }

void User::setName(const std::string& name) { m_name = name; }
void User::setEmail(const std::string& email) { m_email = email; }
void User::setActive(bool active) { m_active = active; }

std::string User::toString() const {
    std::ostringstream oss;
    oss << "User{id=" << m_id
        << ", name=\"" << m_name
        << "\", email=\"" << m_email
        << "\", active=" << (m_active ? "true" : "false")
        << "}";
    return oss.str();
}

} // namespace app
