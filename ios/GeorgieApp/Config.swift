import Foundation
import Security

enum GeorgieConfig {
    static let baseURL = URL(string: "https://georgie-kappa.vercel.app")!
    static let userHeader = "X-Georgie-User"
    static let sessionHeader = "X-Georgie-Session"
    static let deviceTokenKey = "com.sierramarketinginc.georgie.device-token"
    static let deviceIDKey = "com.sierramarketinginc.georgie.device-id"

    static var deviceID: String {
        if let value = UserDefaults.standard.string(forKey: deviceIDKey) { return value }
        let value = UUID().uuidString
        UserDefaults.standard.set(value, forKey: deviceIDKey)
        return value
    }

    static var sessionID: String {
        let key = "com.sierramarketinginc.georgie.session-id"
        if let value = UserDefaults.standard.string(forKey: key) { return value }
        let value = UUID().uuidString
        UserDefaults.standard.set(value, forKey: key)
        return value
    }
}

enum KeychainStore {
    static func save(_ value: String, account: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func read(account: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrAccount as String: account,
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
