#include "UserService.h"
#include "Logger.h"
#include <iostream>

/**
 * Sample application demonstrating user management.
 */

// Global configuration variables
static const int MAX_USERS = 1000;
static const std::string APP_NAME = "UserManager";
static bool verbose = false;

void printBanner() {
    std::cout << "==================================" << std::endl;
    std::cout << "  " << APP_NAME << " v1.0" << std::endl;
    std::cout << "==================================" << std::endl;
}

void printUserList(const std::vector<app::User>& users) {
    std::cout << "\n--- User List (" << users.size() << " users) ---" << std::endl;
    for (const auto& user : users) {
        std::cout << "  " << user.toString() << std::endl;
    }
    std::cout << "---" << std::endl;
}

int main(int argc, char* argv[]) {
    // Parse arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg(argv[i]);
        if (arg == "--verbose" || arg == "-v") {
            verbose = true;
        }
    }

    // Setup logging
    auto& logger = app::Logger::instance();
    if (verbose) {
        logger.setLevel(app::LogLevel::DEBUG);
    }
    logger.info("Starting " + APP_NAME);

    // Initialize repository and service
    app::UserRepository repo;
    app::UserService service(repo);

    // Create some users
    try {
        auto alice = service.createUser("Alice Johnson", "alice@example.com");
        auto bob = service.createUser("Bob Smith", "bob@example.com");
        auto charlie = service.createUser("Charlie Brown", "charlie@example.com");

        if (verbose) {
            logger.debug("Created " + std::to_string(service.getTotalUserCount()) + " users");
        }

        // Print all users
        printBanner();
        printUserList(repo.getAllUsers());

        // Deactivate Bob
        service.deactivateUser(bob.getId());
        std::cout << "\nAfter deactivating Bob:" << std::endl;
        printUserList(repo.getActiveUsers());

        // Change Alice's email
        service.changeEmail(alice.getId(), "alice.johnson@newdomain.com");
        std::cout << "\nAfter updating Alice's email:" << std::endl;
        auto updatedAlice = service.getUser(alice.getId());
        if (updatedAlice) {
            std::cout << "  " << updatedAlice->toString() << std::endl;
        }

        // Search by name
        auto results = repo.findByName("Charlie");
        std::cout << "\nSearch results for 'Charlie':" << std::endl;
        printUserList(results);

        // Print stats
        std::cout << "\nStats:" << std::endl;
        std::cout << "  Total users: " << service.getTotalUserCount() << std::endl;
        std::cout << "  Active users: " << service.getActiveUserCount() << std::endl;
        std::cout << "  Max capacity: " << MAX_USERS << std::endl;

    } catch (const std::exception& e) {
        logger.error(std::string("Error: ") + e.what());
        return 1;
    }

    logger.info("Finished " + APP_NAME);
    return 0;
}
