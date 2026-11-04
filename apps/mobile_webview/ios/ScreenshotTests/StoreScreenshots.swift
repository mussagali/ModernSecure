import XCTest

final class StoreScreenshots: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "kz.modernsecure.modernSecure")
    private var phase = "launch"

    override func tearDownWithError() throws {
        // Diagnostics are kept separate and never selected for App Store upload.
        if testRun?.hasSucceeded == false {
            try? capture("diagnostic-failure")
            let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("AppStoreScreenshots", isDirectory: true)
            try? Data(phase.utf8).write(to: directory.appendingPathComponent("diagnostic-phase.txt"))
        }
        app.terminate()
    }

    private func capture(_ name: String) throws {
        // Actual rendered app pixels. No fixtures, substituted HTML, or overlays.
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AppStoreScreenshots", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        Thread.sleep(forTimeInterval: 1)
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: directory.appendingPathComponent(name + ".png"))
        print("SCREENSHOT_CAPTURED: " + name)
    }

    private func tapLink(_ label: String) throws {
        let link = app.webViews.links.matching(NSPredicate(format: "label == %@", label)).firstMatch
        guard link.waitForExistence(timeout: 30) else { throw CaptureError.missingNavigation }
        for _ in 0..<3 where !link.isHittable { app.webViews.firstMatch.swipeUp() }
        guard link.isHittable else { throw CaptureError.missingNavigation }
        link.tap()
    }

    func testCaptureSyntheticCase() throws {
        continueAfterFailure = false
        executionTimeAllowance = 240
        let environment = ProcessInfo.processInfo.environment
        guard let email = environment["SCREENSHOT_EMAIL"],
              email == "apple-review-modernsecure@example.test",
              let password = environment["SCREENSHOT_PASSWORD"], !password.isEmpty
        else { throw CaptureError.missingDedicatedAccess }

        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
        app.launch()
        phase = "waiting-for-login"
        let emailField = app.webViews.textFields.firstMatch
        guard emailField.waitForExistence(timeout: 90) else { throw CaptureError.loginUnavailable }
        phase = "entering-dedicated-email"
        emailField.tap()
        emailField.typeText(email)
        guard (emailField.value as? String) == email else { throw CaptureError.inputValueMismatch }
        let passwordField = app.webViews.secureTextFields.firstMatch
        guard passwordField.exists else { throw CaptureError.loginUnavailable }
        phase = "entering-dedicated-password"
        passwordField.tap()
        // Give WebKit time to process each secure-field keystroke on a slow VM.
        for character in password {
            passwordField.typeText(String(character))
        }
        let enteredLength = (passwordField.value as? String)?.count ?? -1
        print("SCREENSHOT_INPUT_CHECK: emailMatches=true; passwordLength=" + String(enteredLength))
        guard enteredLength == password.count else { throw CaptureError.inputValueMismatch }
        let login = app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Войти")).firstMatch
        guard login.exists else { throw CaptureError.loginUnavailable }
        login.tap()
        phase = "waiting-for-synthetic-case-after-login"

        // Never capture an arbitrary account or a real client case.
        let demo = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", "ДЕМО APPLE")).firstMatch
        guard demo.waitForExistence(timeout: 90) else { throw CaptureError.demoCaseUnavailable }
        try capture("01-cases")
        phase = "opening-case"
        demo.tap()
        guard app.webViews.staticTexts["Текущий этап"].waitForExistence(timeout: 45)
        else { throw CaptureError.caseUnavailable }
        try capture("02-case-overview")

        phase = "opening-tasks"
        try tapLink("Задачи")
        guard app.webViews.staticTexts["Задачи по делу"].waitForExistence(timeout: 45)
        else { throw CaptureError.tasksUnavailable }
        try capture("03-tasks")

        phase = "opening-documents"
        try tapLink("Документы")
        guard app.webViews.links["Нужно загрузить"].waitForExistence(timeout: 45)
        else { throw CaptureError.documentsUnavailable }
        try capture("04-documents")
    }

    private enum CaptureError: Error {
        case missingDedicatedAccess, loginUnavailable, demoCaseUnavailable, inputValueMismatch
        case caseUnavailable, tasksUnavailable, documentsUnavailable, missingNavigation
    }
}
