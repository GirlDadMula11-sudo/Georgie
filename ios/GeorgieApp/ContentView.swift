import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: AssistantStore
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private let gold = Color(red: 0.86, green: 0.70, blue: 0.32)

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(colors: [.black, Color(red: 0.04, green: 0.04, blue: 0.045)], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 18) {
                        header
                        identity
                        if store.isEnrolled {
                            capabilityGrid
                            if !store.messages.isEmpty { conversation }
                            commandCenter
                            sierraDesk
                            voiceControl
                        } else {
                            activationCard
                        }
                    }
                    .padding(.horizontal, 18).padding(.bottom, 34)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if store.isEnrolled {
                    composer
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial)
                        .overlay(alignment: .top) {
                            Rectangle().fill(gold.opacity(0.22)).frame(height: 1)
                        }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .alert("Georgie", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
                Button("OK", role: .cancel) { store.errorMessage = nil }
            } message: { Text(store.errorMessage ?? "") }
        }
    }

    private var header: some View {
        HStack {
            Image(systemName: "gearshape.fill").foregroundStyle(gold)
            Spacer()
            VStack(spacing: 2) {
                Text("GEORGIE").font(.system(size: 30, weight: .semibold, design: .rounded)).tracking(4).foregroundStyle(gold)
                Text("Your Personal AI Assistant").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(); Image(systemName: "bell.fill").foregroundStyle(gold)
        }.padding(.top, 8)
    }

    private var identity: some View {
        VStack(spacing: 10) {
            Image("GeorgieAvatar").resizable().scaledToFill().frame(width: horizontalSizeClass == .compact ? 128 : 188, height: horizontalSizeClass == .compact ? 128 : 188).clipShape(Circle()).overlay(Circle().stroke(gold, lineWidth: 3)).shadow(color: gold.opacity(0.22), radius: 24)
            Text("Georgie").font(.title.bold()).foregroundStyle(gold)
            HStack(spacing: 7) {
                Circle().fill(store.isEnrolled && store.isReady ? .green : .orange).frame(width: 8, height: 8)
                Text(store.status).font(.subheadline).foregroundStyle(store.isEnrolled && store.isReady ? .green : .orange)
            }
            Text("I’m here to help you stay ahead and get things done.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(12).frame(maxWidth: .infinity).background(.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(gold.opacity(0.28)))
        }
    }

    private var activationCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Securely activate this iPhone", systemImage: "iphone.and.arrow.forward").font(.headline).foregroundStyle(gold)
            Text("This one-time step pairs this device with your private Georgie account. The resulting device credential is stored only in iPhone Keychain.").font(.subheadline).foregroundStyle(.secondary)
            SecureField("One-time activation code", text: $store.enrollmentCode).textInputAutocapitalization(.never).autocorrectionDisabled().padding(13).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
            Button { Task { await store.enroll() } } label: {
                HStack { Spacer(); if store.isBusy { ProgressView().tint(.black) } else { Image(systemName: "lock.open.fill") }; Text("ACTIVATE THIS IPHONE").font(.headline); Spacer() }
                    .padding(.vertical, 15).background(gold, in: Capsule()).foregroundStyle(.black)
            }.disabled(store.isBusy || store.enrollmentCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }.padding(17).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 20)).overlay(RoundedRectangle(cornerRadius: 20).stroke(gold.opacity(0.3)))
    }

    private var capabilityGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: horizontalSizeClass == .compact ? 2 : 4), spacing: 8) {
            CapabilityTile(icon: "brain.head.profile", title: "Memory", value: "Active")
            CapabilityTile(icon: "checkmark.circle", title: "Tasks", value: "\(store.tasks.count) Open")
            CapabilityTile(icon: "building.2", title: "Sierra", value: store.sierraHealthStatus)
            CapabilityTile(icon: "desktopcomputer", title: "Mac", value: "Agent")
        }
    }

    private var conversation: some View {
        VStack(spacing: 9) { ForEach(store.messages.suffix(8)) { message in HStack { if message.role == "user" { Spacer(minLength: 40) }; Text(message.content).font(.body).fixedSize(horizontal: false, vertical: true).textSelection(.enabled).padding(12).background(message.role == "user" ? gold.opacity(0.16) : Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(message.role == "user" ? gold.opacity(0.35) : .white.opacity(0.08))); if message.role != "user" { Spacer(minLength: 40) } } } }
    }

    private var commandCenter: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("COMMAND CENTER").font(.caption.bold()).foregroundStyle(gold)
                Spacer()
                Text(store.commandCenter?.authority.replacingOccurrences(of: "_", with: " ").uppercased() ?? "READ ONLY").font(.caption2).foregroundStyle(.secondary)
            }
            if let command = store.commandCenter {
                HStack(spacing: 8) {
                    CommandMetric(value: command.summary.openTasks, label: "Tasks")
                    CommandMetric(value: command.summary.pendingApprovals, label: "Approvals")
                    CommandMetric(value: command.summary.recordedDecisions, label: "Decisions")
                }
                if command.priorities.isEmpty {
                    Text("No open priorities right now.").foregroundStyle(.secondary).font(.subheadline)
                } else {
                    ForEach(command.priorities.prefix(5)) { item in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: item.domain == "sierra" ? "building.2" : "person.crop.circle").foregroundStyle(gold)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title).font(.subheadline.weight(.medium))
                                Text("\(item.domain.capitalized) · \(item.priority.capitalized)").font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                    }
                }
                Label(command.executionEnabled ? "Execution enabled" : "Observe, recommend, and prepare only", systemImage: "lock.shield")
                    .font(.caption2).foregroundStyle(command.executionEnabled ? .orange : .green)
            } else {
                Text("Loading secure priorities…").foregroundStyle(.secondary).font(.subheadline)
            }
        }.padding(15).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(gold.opacity(0.24)))
    }

    private var sierraDesk: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("SIERRA CAPITAL DESK").font(.caption.bold()).foregroundStyle(gold)
                    Text(store.sierraHealthStatus).font(.caption2).foregroundStyle(store.sierraHealthStatus.lowercased() == "healthy" ? .green : .secondary)
                }
                Spacer()
                Button { Task { await store.refreshDashboard() } } label: { Image(systemName: "arrow.clockwise").foregroundStyle(gold) }
            }
            if store.sierraDeals.isEmpty {
                Text("No Sierra deals available yet.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ForEach(store.sierraDeals.prefix(5)) { deal in
                    Button { Task { await store.askAboutSierraDeal(deal) } } label: {
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(deal.legalBusinessName ?? deal.referenceNumber).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(1)
                                Text("\(deal.referenceNumber) · \(deal.currentStage ?? "File Build")").font(.caption2).foregroundStyle(.secondary)
                                if let action = deal.nextAction, !action.isEmpty { Text(action).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 4) {
                                if let amount = deal.requestedAmount { Text(amount, format: .currency(code: "USD").precision(.fractionLength(0))).font(.caption.weight(.semibold)).foregroundStyle(gold) }
                                Text((deal.attentionLevel ?? "Normal").uppercased()).font(.system(size: 9, weight: .bold)).foregroundStyle((deal.attentionLevel ?? "").lowercased() == "high" ? .orange : .green)
                            }
                        }
                        .padding(11)
                        .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.06)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }.padding(15).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(gold.opacity(0.3)))
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Ask Georgie anything…", text: $store.textInput, axis: .vertical).textFieldStyle(.plain).font(.body).lineLimit(1...5).padding(13).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 15)).submitLabel(.send).onSubmit { Task { await store.sendText() } }
            Button { Task { await store.sendText() } } label: { Image(systemName: "arrow.up").font(.headline).frame(width: 44, height: 44).background(gold, in: Circle()).foregroundStyle(.black) }.disabled(store.isBusy || store.textInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .accessibilityElement(children: .contain)
    }

    private var voiceControl: some View {
        VStack(spacing: 8) {
            Button { if store.audio.isRecording { Task { await store.finishVoice() } } else { Task { await store.startVoice() } } } label: {
                HStack(spacing: 12) { Image(systemName: store.audio.isRecording ? "waveform" : "mic.fill").font(.title2); Text(store.audio.isRecording ? "LISTENING…" : "TAP TO TALK").font(.headline) }.frame(maxWidth: .infinity).padding(.vertical, 19).foregroundStyle(.black).background(gold, in: Capsule()).shadow(color: gold.opacity(0.25), radius: 20)
            }.disabled(store.isBusy && !store.audio.isRecording).accessibilityLabel(store.audio.isRecording ? "Send voice command" : "Talk to Georgie")
            Text(store.audio.isRecording ? "Speak naturally. Georgie sends when you stop." : "Tap once, or say “Hey Siri, wake Georgie.”")
                .font(.caption2).foregroundStyle(store.audio.isRecording ? .green : .secondary)
            if store.handsFreeMode {
                Button("END HANDS-FREE") { store.endHandsFree() }
                    .font(.caption.bold()).foregroundStyle(.red)
            }
        }
    }
}

private struct CapabilityTile: View {
    let icon: String; let title: String; let value: String
    var body: some View { VStack(spacing: 5) { Image(systemName: icon).font(.title3).foregroundStyle(Color(red: 0.86, green: 0.70, blue: 0.32)); Text(title).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8); Text(value).font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7) }.frame(maxWidth: .infinity, minHeight: 74).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 15)).overlay(RoundedRectangle(cornerRadius: 15).stroke(Color(red: 0.86, green: 0.70, blue: 0.32).opacity(0.25))) }
}

private struct CommandMetric: View {
    let value: Int
    let label: String
    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.headline)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
    }
}
