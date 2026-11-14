import XCTest
import UIKit

final class StoreScreenshots: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "kz.modernsecure.modernSecure")
    private var phase = "launch" { didSet { savePhase() } }

    private func outputDirectory() throws -> URL {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["SCREENSHOT_OUTPUT_DIRECTORY"],
              let home = environment["SIMULATOR_HOST_HOME"], path.hasPrefix(home + "/")
        else { throw CaptureError.missingCaptureDirectory }
        let directory = URL(fileURLWithPath: path, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func savePhase() {
        guard let directory = try? outputDirectory() else { return }
        try? Data(phase.utf8).write(to: directory.appendingPathComponent("diagnostic-phase.txt"), options: .atomic)
    }

    override func tearDownWithError() throws {
        // Diagnostics are kept separate and never selected for App Store upload.
        if testRun?.hasSucceeded == false {
            savePhase()
            try? capture("diagnostic-failure")
        }
        app.terminate()
    }

    private func capture(_ name: String) throws {
        // Actual rendered app pixels. No fixtures, substituted HTML, or overlays.
        let directory = try outputDirectory()
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

    private func pasteDedicatedPassword(_ password: String, into field: XCUIElement) throws {
        // Use the ordinary iOS edit menu, avoiding secure keyboard event loss
        // on slow cloud Simulators. The disposable device clipboard is cleared.
        UIPasteboard.general.string = password
        defer { UIPasteboard.general.items = [] }
        field.press(forDuration: 1.2)
        let paste = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@ OR label == %@", "Вставить", "Paste")
        ).firstMatch
        guard paste.waitForExistence(timeout: 15) else { throw CaptureError.pasteUnavailable }
        paste.tap()
        let allowPaste = app.buttons.matching(NSPredicate(
            format: "label == %@ OR label == %@", "Разрешить вставку", "Allow Paste"
        )).firstMatch
        if allowPaste.waitForExistence(timeout: 3) { allowPaste.tap() }
    }

    func testCaptureSyntheticCase() throws {
        continueAfterFailure = false
        executionTimeAllowance = 240
        let environment = ProcessInfo.processInfo.environment
        guard let email = environment["SCREENSHOT_EMAIL"],
              email == "apple-review-modernsecure@example.test",
              let password = environment["SCREENSHOT_PASSWORD"], password.count == 40
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
        try pasteDedicatedPassword(password, into: passwordField)
        let enteredLength = (passwordField.value as? String)?.count ?? -1
        print("SCREENSHOT_INPUT_CHECK: emailMatches=true; secureValueReportedLength=" + String(enteredLength))
        // Secure accessibility values may be obscured; authentication and the
        // full synthetic-case gate below validate the actual submitted input.
        if let value = passwordField.value as? String, value.isEmpty || value == "Пароль" {
            throw CaptureError.inputValueMismatch
        }
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
        case missingDedicatedAccess, loginUnavailable, demoCaseUnavailable, inputValueMismatch, missingCaptureDirectory, pasteUnavailable
        case caseUnavailable, tasksUnavailable, documentsUnavailable, missingNavigation
    }
}
