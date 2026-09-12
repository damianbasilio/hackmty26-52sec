import ExpoModulesCore
import MultipeerConnectivity

public final class ExpoNearbySplitModule: Module {
  private var coordinator: NearbySplitCoordinator?

  public func definition() -> ModuleDefinition {
    Name("ExpoNearbySplit")

    Events("onStatus", "onPeerJoined", "onPeerLeft", "onPayload")

    Function("isSupported") {
      true
    }

    AsyncFunction("startHost") { (displayName: String, roomCode: String, initialPayload: String) in
      self.coordinator?.stop()
      let coordinator = NearbySplitCoordinator { [weak self] event, payload in
        self?.sendEvent(event, payload)
      }
      self.coordinator = coordinator
      coordinator.startHost(displayName: displayName, roomCode: roomCode, initialPayload: initialPayload)
    }

    AsyncFunction("joinNearby") { (displayName: String, roomCode: String) in
      self.coordinator?.stop()
      let coordinator = NearbySplitCoordinator { [weak self] event, payload in
        self?.sendEvent(event, payload)
      }
      self.coordinator = coordinator
      coordinator.joinNearby(displayName: displayName, roomCode: roomCode)
    }

    AsyncFunction("broadcast") { (payload: String) in
      try self.coordinator?.broadcast(payload)
    }

    AsyncFunction("stop") {
      self.coordinator?.stop()
      self.coordinator = nil
    }

    OnDestroy {
      self.coordinator?.stop()
      self.coordinator = nil
    }
  }
}

private final class NearbySplitCoordinator: NSObject {
  private let serviceType = "c1-split"
  private let emit: (String, [String: Any]) -> Void
  private var localPeer: MCPeerID?
  private var session: MCSession?
  private var advertiser: MCNearbyServiceAdvertiser?
  private var browser: MCNearbyServiceBrowser?
  private var expectedRoomCode = ""
  private var outboundRoomCode = ""
  private var latestPayload = ""
  private var invitedPeers = Set<String>()

  init(emit: @escaping (String, [String: Any]) -> Void) {
    self.emit = emit
    super.init()
  }

  func startHost(displayName: String, roomCode: String, initialPayload: String) {
    stop()
    expectedRoomCode = roomCode
    latestPayload = initialPayload
    let peer = MCPeerID(displayName: sanitized(displayName))
    let activeSession = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
    activeSession.delegate = self
    let activeAdvertiser = MCNearbyServiceAdvertiser(
      peer: peer,
      discoveryInfo: ["kind": "capital-one-split"],
      serviceType: serviceType
    )
    activeAdvertiser.delegate = self
    localPeer = peer
    session = activeSession
    advertiser = activeAdvertiser
    activeAdvertiser.startAdvertisingPeer()
    emitStatus("advertising", "Esperando teléfonos cercanos")
  }

  func joinNearby(displayName: String, roomCode: String) {
    stop()
    outboundRoomCode = roomCode
    let peer = MCPeerID(displayName: sanitized(displayName))
    let activeSession = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
    activeSession.delegate = self
    let activeBrowser = MCNearbyServiceBrowser(peer: peer, serviceType: serviceType)
    activeBrowser.delegate = self
    localPeer = peer
    session = activeSession
    browser = activeBrowser
    activeBrowser.startBrowsingForPeers()
    emitStatus("browsing", "Buscando una división cercana")
  }

  func broadcast(_ payload: String) throws {
    latestPayload = payload
    guard let session, !session.connectedPeers.isEmpty else { return }
    try session.send(Data(payload.utf8), toPeers: session.connectedPeers, with: .reliable)
  }

  func stop() {
    advertiser?.stopAdvertisingPeer()
    browser?.stopBrowsingForPeers()
    session?.disconnect()
    advertiser?.delegate = nil
    browser?.delegate = nil
    session?.delegate = nil
    advertiser = nil
    browser = nil
    session = nil
    localPeer = nil
    expectedRoomCode = ""
    outboundRoomCode = ""
    latestPayload = ""
    invitedPeers.removeAll()
  }

  private func sanitized(_ value: String) -> String {
    let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return String((cleaned.isEmpty ? "Invitado" : cleaned).prefix(40))
  }

  private func emitStatus(_ status: String, _ message: String? = nil) {
    var payload: [String: Any] = ["status": status]
    if let message { payload["message"] = message }
    emit("onStatus", payload)
  }

  private func sendLatestPayload(to peer: MCPeerID) {
    guard let session, !latestPayload.isEmpty else { return }
    do {
      try session.send(Data(latestPayload.utf8), toPeers: [peer], with: .reliable)
    } catch {
      emitStatus("error", "No pudimos sincronizar la división")
    }
  }
}

extension NearbySplitCoordinator: MCNearbyServiceAdvertiserDelegate {
  func advertiser(
    _ advertiser: MCNearbyServiceAdvertiser,
    didReceiveInvitationFromPeer peerID: MCPeerID,
    withContext context: Data?,
    invitationHandler: @escaping (Bool, MCSession?) -> Void
  ) {
    let suppliedCode = context.flatMap { String(data: $0, encoding: .utf8) }
    guard suppliedCode == expectedRoomCode, let session else {
      invitationHandler(false, nil)
      emitStatus("denied", "El código de acceso no coincide")
      return
    }
    invitationHandler(true, session)
    emitStatus("connecting", "Verificando dispositivo cercano")
  }

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
    emitStatus("error", error.localizedDescription)
  }
}

extension NearbySplitCoordinator: MCNearbyServiceBrowserDelegate {
  func browser(
    _ browser: MCNearbyServiceBrowser,
    foundPeer peerID: MCPeerID,
    withDiscoveryInfo info: [String: String]?
  ) {
    guard info?["kind"] == "capital-one-split",
          !invitedPeers.contains(peerID.displayName),
          let session else { return }
    invitedPeers.insert(peerID.displayName)
    browser.invitePeer(
      peerID,
      to: session,
      withContext: Data(outboundRoomCode.utf8),
      timeout: 20
    )
    emitStatus("connecting", "División encontrada. Conectando…")
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    invitedPeers.remove(peerID.displayName)
  }

  func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
    emitStatus("error", error.localizedDescription)
  }
}

extension NearbySplitCoordinator: MCSessionDelegate {
  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    switch state {
    case .connected:
      emitStatus("connected", "Conexión privada establecida")
      emit("onPeerJoined", ["peerId": peerID.displayName, "displayName": peerID.displayName])
      sendLatestPayload(to: peerID)
    case .notConnected:
      emit("onPeerLeft", ["peerId": peerID.displayName, "displayName": peerID.displayName])
    case .connecting:
      emitStatus("connecting", "Estableciendo conexión cifrada")
    @unknown default:
      emitStatus("error", "Estado de conexión desconocido")
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    guard let json = String(data: data, encoding: .utf8) else { return }
    emit("onPayload", [
      "peerId": peerID.displayName,
      "displayName": peerID.displayName,
      "json": json,
    ])
  }

  func session(
    _ session: MCSession,
    didReceive stream: InputStream,
    withName streamName: String,
    fromPeer peerID: MCPeerID
  ) {}

  func session(
    _ session: MCSession,
    didStartReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID,
    with progress: Progress
  ) {}

  func session(
    _ session: MCSession,
    didFinishReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID,
    at localURL: URL?,
    withError error: Error?
  ) {}
}
