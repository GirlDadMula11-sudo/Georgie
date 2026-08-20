import AppKit
import AVFoundation
import Foundation

final class GeorgieCloudVoice: NSObject, AVAudioPlayerDelegate {
    private let server = URL(string: "https://georgie.onrender.com")!
    private var player: AVAudioPlayer?
    private var completion: ((Bool) -> Void)?
    private var requestTask: URLSessionDataTask?

    var isSpeaking: Bool { player?.isPlaying == true }

    func stop() {
        requestTask?.cancel()
        requestTask = nil
        player?.stop()
        player = nil
        completion = nil
    }

    func speak(_ text: String, completion: @escaping (Bool) -> Void) {
        stop()
        self.completion = completion

        var request = URLRequest(url: server.appendingPathComponent("api/speak"))
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])

        requestTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                guard error == nil,
                      let http = response as? HTTPURLResponse,
                      (200..<300).contains(http.statusCode),
                      let data = data,
                      !data.isEmpty else {
                    self.finish(false)
                    return
                }
                do {
                    self.player = try AVAudioPlayer(data: data)
                    self.player?.delegate = self
                    self.player?.prepareToPlay()
                    if self.player?.play() != true { self.finish(false) }
                } catch {
                    self.finish(false)
                }
            }
        }
        requestTask?.resume()
    }

    private func finish(_ success: Bool) {
        requestTask = nil
        player = nil
        let done = completion
        completion = nil
        done?(success)
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        finish(flag)
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        finish(false)
    }
}
