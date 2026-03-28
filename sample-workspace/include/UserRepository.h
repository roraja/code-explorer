#pragma once
#include "User.h"
#include <vector>
#include <optional>
#include <functional>

namespace app {

/**
 * Manages a collection of users with CRUD operations.
 * Supports filtering and searching.
 */
class UserRepository {
public:
    UserRepository();
    ~UserRepository() = default;

    // CRUD
    void addUser(const User& user);
    std::optional<User> findById(int id) const;
    std::vector<User> findByName(const std::string& nameQuery) const;
    bool updateUser(int id, const User& updated);
    bool removeUser(int id);

    // Bulk operations
    std::vector<User> getAllUsers() const;
    std::vector<User> getActiveUsers() const;
    int countUsers() const;

    // Filtering
    std::vector<User> filter(std::function<bool(const User&)> predicate) const;

private:
    std::vector<User> m_users;
    int m_nextId;

    // Internal helpers
    std::vector<User>::iterator findIterator(int id);
    std::vector<User>::const_iterator findConstIterator(int id) const;
};

} // namespace app
