#pragma once
#include "UserRepository.h"
#include <string>

namespace app {

/**
 * Provides business logic for user management.
 * Delegates storage to UserRepository.
 */
class UserService {
public:
    explicit UserService(UserRepository& repo);
    ~UserService() = default;

    // Business operations
    User createUser(const std::string& name, const std::string& email);
    std::optional<User> getUser(int id) const;
    bool deactivateUser(int id);
    bool changeEmail(int id, const std::string& newEmail);

    // Validation
    static bool isValidEmail(const std::string& email);
    static bool isValidName(const std::string& name);

    // Stats
    int getActiveUserCount() const;
    int getTotalUserCount() const;

private:
    UserRepository& m_repo;

    void validateOrThrow(const std::string& name, const std::string& email) const;
};

} // namespace app
