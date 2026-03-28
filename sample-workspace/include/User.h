#pragma once
#include <string>
#include <vector>

namespace app {

/**
 * Represents a user in the system.
 */
class User {
public:
    User(int id, const std::string& name, const std::string& email);
    ~User() = default;

    // Getters
    int getId() const;
    std::string getName() const;
    std::string getEmail() const;
    bool isActive() const;

    // Setters
    void setName(const std::string& name);
    void setEmail(const std::string& email);
    void setActive(bool active);

    // Serialization
    std::string toString() const;

private:
    int m_id;
    std::string m_name;
    std::string m_email;
    bool m_active;
};

} // namespace app
