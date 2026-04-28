import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView, TextInput, Alert, ActivityIndicator, Modal, PanResponder } from "react-native";
import { useState, useRef, useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import api from "../../services/api";

const MODES = { IDLE: "idle", CAMERA: "camera", CROP: "crop", REVIEW: "review", UPLOADING: "uploading", EDIT_OUTPUT: "edit_output" };

export default function CaptureScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const targetDocId = params.targetDocId;

  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState(targetDocId ? MODES.CAMERA : MODES.IDLE);
  const [photos, setPhotos] = useState([]);
  const [title, setTitle] = useState("");
  const [facing, setFacing] = useState("back");
  const [flash, setFlash] = useState("off");
  const cameraRef = useRef(null);

  // Edit Output & Channel Push states
  const [extractedText, setExtractedText] = useState("");
  const [createdDocId, setCreatedDocId] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [showChannelSelect, setShowChannelSelect] = useState(false);
  const [joinedChannels, setJoinedChannels] = useState([]);
  const [submittingToChannel, setSubmittingToChannel] = useState(false);
  
  useEffect(() => {
    if (targetDocId) {
      setMode(MODES.CAMERA);
      const fetchDoc = async () => {
        try {
          const res = await api.get(`/documents/${targetDocId}`);
          setTitle(res.data.title);
        } catch (err) {
          console.error("Failed to fetch document:", err);
        }
      };
      fetchDoc();
    }
  }, [targetDocId]);

  async function openCamera() {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setMode(MODES.CAMERA);
  }

  async function takePicture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.8 });
    setCurrentPhoto(photo);
    setCropPoints([
      { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }
    ]);
    setMode(MODES.CROP);
  }

  function confirmCrop() {
    if (editingIndex >= 0) {
      setPhotos(prev => {
        const next = [...prev];
        next[editingIndex] = { ...currentPhoto, crop: cropPoints };
        return next;
      });
    } else {
      setPhotos(prev => [...prev, { ...currentPhoto, crop: cropPoints }]);
    }
    setMode(MODES.CAMERA);
    setCurrentPhoto(null);
    setEditingIndex(-1);
  }

  async function uploadAndCreate() {
    if (!targetDocId && !title.trim()) { Alert.alert("Title required", "Give your notes a title."); return; }
    if (photos.length === 0) { Alert.alert("No photos", "Take at least one photo."); return; }
    
    setMode(MODES.UPLOADING);
    try {
      const formData = new FormData();
      if (!targetDocId) formData.append("title", title.trim());
      
      photos.forEach((p, i) => {
        formData.append(`image_${i}`, { uri: p.uri, name: `photo_${i}.jpg`, type: "image/jpeg" });
        if (p.crop) {
          formData.append(`crop_${i}`, JSON.stringify(p.crop));
        }
      });

      let res;
      if (targetDocId) {
        res = await api.post(`/documents/${targetDocId}/pages`, formData, { headers: { "Content-Type": "multipart/form-data" } });
        setCreatedDocId(targetDocId);
      } else {
        res = await api.post("/documents/create", formData, { headers: { "Content-Type": "multipart/form-data" } });
        setCreatedDocId(res.data.id);
      }

      setPhotos([]);
      setExtractedText(res.data.extracted_text);
      setMode(MODES.EDIT_OUTPUT);
    } catch {
      Alert.alert("Upload failed", "Could not save. Check your connection.");
      setMode(MODES.REVIEW);
    }
  }

  async function saveDocs() {
    if (!title.trim()) { Alert.alert("Title required", "Give your notes a title before saving."); return; }
    setSavingEdit(true);
    try {
      await api.put(`/documents/${createdDocId}`, { title: title.trim(), extracted_text: extractedText });
      Alert.alert("✓ Saved!", "Your notes have been updated and saved.");
      setMode(MODES.IDLE);
      setTitle("");
      setExtractedText("");
    } catch { Alert.alert("Error", "Could not save changes."); }
    finally { setSavingEdit(false); }
  }

  async function fetchJoinedChannels() {
    try {
      const res = await api.get("/channels");
      setJoinedChannels(res.data.filter(c => c.is_member));
      setShowChannelSelect(true);
    } catch { Alert.alert("Error", "Could not load channels."); }
  }

  async function submitToChannel(channelId) {
    if (!title.trim()) { Alert.alert("Title required", "Give your notes a title before pushing."); return; }
    setSubmittingToChannel(true);
    try {
      // First save the current edits
      await api.put(`/documents/${createdDocId}`, { title: title.trim(), extracted_text: extractedText });
      // Then submit to channel
      await api.post(`/channels/${channelId}/submit`, { document_id: createdDocId });
      Alert.alert("✓ Pushed to Channel", "Note submitted for admin approval.");
      setShowChannelSelect(false);
      setMode(MODES.IDLE);
      setTitle("");
      setExtractedText("");
    } catch { Alert.alert("Error", "Could not push to channel."); }
    finally { setSubmittingToChannel(false); }
  }

  // Cropping states & Refs to avoid stale closures in PanResponder
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [cropPoints, setCropPoints] = useState([
    { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }
  ]);
  const [imageLayout, setImageLayout] = useState({ width: 0, height: 0 });
  const layoutRef = useRef({ width: 0, height: 0 });
  const cropPointsRef = useRef(cropPoints);
  const activeIndex = useRef(-1);
  const [editingIndex, setEditingIndex] = useState(-1);

  useEffect(() => {
    cropPointsRef.current = cropPoints;
  }, [cropPoints]);

  const CropLine = ({ p1, p2, layout }) => {
    if (!layout.width) return null;
    const x1 = p1.x * layout.width;
    const y1 = p1.y * layout.height;
    const x2 = p2.x * layout.width;
    const y2 = p2.y * layout.height;
    const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    return (
      <View style={{
        position: "absolute",
        left: x1,
        top: y1,
        width: length,
        height: 2,
        backgroundColor: "rgba(245,166,35,0.8)",
        transform: [{ rotate: `${angle}rad` }],
        transformOrigin: "left center"
      }} />
    );
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e, gs) => {
        const { width, height } = layoutRef.current;
        if (width === 0) return;
        const { locationX, locationY } = e.nativeEvent;
        let minDist = Infinity;
        let index = -1;
        cropPointsRef.current.forEach((p, i) => {
          const dx = (p.x * width) - locationX;
          const dy = (p.y * height) - locationY;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < minDist) { minDist = dist; index = i; }
        });
        if (minDist < 100) activeIndex.current = index;
        else activeIndex.current = -1;
      },
      onPanResponderMove: (e, gs) => {
        const { width, height } = layoutRef.current;
        if (activeIndex.current === -1 || width === 0) return;
        const { locationX, locationY } = e.nativeEvent;
        const nx = Math.max(0, Math.min(1, locationX / width));
        const ny = Math.max(0, Math.min(1, locationY / height));
        
        setCropPoints(prev => {
          const next = [...prev];
          next[activeIndex.current] = { x: nx, y: ny };
          return next;
        });
      },
      onPanResponderRelease: () => { activeIndex.current = -1; }
    })
  ).current;

  // Camera mode
  if (mode === MODES.CAMERA) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing} flash={flash} />
        <View style={cam.topBar}>
          <View style={{ flexDirection: "row", alignItems: "center", width: 80 }}>
            <TouchableOpacity onPress={() => setMode(MODES.IDLE)} style={cam.iconBtn}>
              <Ionicons name="close" size={28} color="white" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFlash(f => f === "off" ? "on" : "off")} style={[cam.iconBtn, { marginLeft: 10 }]}>
              <Ionicons name={flash === "on" ? "flash" : "flash-off"} size={24} color="white" />
            </TouchableOpacity>
          </View>
          <View style={cam.badge}>
            <Text style={cam.badgeText}>{photos.length} photo{photos.length !== 1 ? "s" : ""}</Text>
          </View>
          <View style={{ width: 80, alignItems: "flex-end" }}>
            {photos.length > 0 && (
              <TouchableOpacity onPress={() => setMode(MODES.REVIEW)} style={cam.doneBtn}>
                <Text style={{ color: "#0A0A0F", fontWeight: "bold" }}>Review</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <View style={cam.bottomBar}>
          <TouchableOpacity onPress={takePicture}>
            <View style={cam.shutter} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setFacing(f => f === "back" ? "front" : "back")} style={{ position: "absolute", right: 40, bottom: 65 }}>
            <Ionicons name="camera-reverse" size={32} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Crop mode
  if (mode === MODES.CROP) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.navBar}>
          <TouchableOpacity onPress={() => setMode(MODES.CAMERA)}>
            <Ionicons name="close" size={24} color="#F5A623" />
          </TouchableOpacity>
          <Text style={s.navTitle}>Crop Document</Text>
          <TouchableOpacity onPress={confirmCrop}>
            <Text style={{ color: "#F5A623", fontWeight: "bold" }}>Confirm</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, padding: 20, justifyContent: "center" }}>
          <View 
            style={{ width: "100%", aspectRatio: currentPhoto?.width ? currentPhoto.width / currentPhoto.height : 3/4, backgroundColor: "#1E1A4A", borderRadius: 10, overflow: "hidden" }}
            onLayout={(e) => {
              const layout = e.nativeEvent.layout;
              setImageLayout(layout);
              layoutRef.current = layout;
            }}
            {...panResponder.panHandlers}
          >
            {currentPhoto && <Image source={{ uri: currentPhoto.uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />}
            {imageLayout.width > 0 && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <CropLine p1={cropPoints[0]} p2={cropPoints[1]} layout={imageLayout} />
                <CropLine p1={cropPoints[1]} p2={cropPoints[2]} layout={imageLayout} />
                <CropLine p1={cropPoints[2]} p2={cropPoints[3]} layout={imageLayout} />
                <CropLine p1={cropPoints[3]} p2={cropPoints[0]} layout={imageLayout} />
                {cropPoints.map((p, i) => (
                  <View
                    key={i}
                    style={[
                      s.cropHandle,
                      { left: p.x * imageLayout.width - 22, top: p.y * imageLayout.height - 22 }
                    ]}
                  >
                    <View style={s.cropHandleInner} />
                  </View>
                ))}
              </View>
            )}
          </View>
          <Text style={{ color: "#7A6DC4", textAlign: "center", marginTop: 20 }}>Drag the corners to align with your document.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Review mode
  if (mode === MODES.REVIEW) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.navBar}>
          <TouchableOpacity onPress={() => setMode(MODES.CAMERA)}>
            <Ionicons name="arrow-back" size={24} color="#F5A623" />
          </TouchableOpacity>
          <Text style={s.navTitle}>Review ({photos.length})</Text>
          <TouchableOpacity onPress={() => setMode(MODES.CAMERA)}>
            <Text style={{ color: "#F5A623" }}>+ Add</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          {!targetDocId && (
            <>
              <Text style={s.label}>Document Title</Text>
              <TextInput style={s.input} placeholder="e.g. Chemistry Lecture 5" placeholderTextColor="#4a4460" value={title} onChangeText={setTitle} />
              <View style={{ height: 20 }} />
            </>
          )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {photos.map((p, i) => (
                <View key={i} style={{ width: "30%" }}>
                  <TouchableOpacity 
                    style={{ width: "100%", aspectRatio: 3/4, borderRadius: 10, overflow: "hidden", backgroundColor: "#1E1A4A" }}
                    onPress={() => {
                      setCurrentPhoto(p);
                      setCropPoints(p.crop);
                      setEditingIndex(i);
                      setMode(MODES.CROP);
                    }}
                  >
                    <Image source={{ uri: p.uri }} style={{ width: "100%", height: "100%" }} />
                    {p.crop && (
                      <View style={StyleSheet.absoluteFill} pointerEvents="none">
                        <View style={{ 
                          position: "absolute", 
                          left: p.crop[0].x * 100 + "%", top: p.crop[0].y * 100 + "%",
                          right: (1 - p.crop[2].x) * 100 + "%", bottom: (1 - p.crop[2].y) * 100 + "%",
                          borderWidth: 1, borderColor: "#F5A623", backgroundColor: "rgba(245,166,35,0.2)"
                        }} />
                      </View>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))} style={s.removeBtn}>
                    <Ionicons name="close" size={12} color="white" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
        </ScrollView>
        <View style={s.bottomAction}>
          <TouchableOpacity style={s.btn} onPress={uploadAndCreate}>
            <Text style={s.btnText}>{targetDocId ? "Append to Document" : "Extract Text & Save PDF"}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Uploading mode
  if (mode === MODES.UPLOADING) {
    return (
      <SafeAreaView style={[s.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color="#F5A623" size="large" />
        <Text style={[s.title, { marginTop: 20 }]}>Extracting text…</Text>
        <Text style={{ color: "#7A6DC4", marginTop: 8 }}>Generating your PDF</Text>
      </SafeAreaView>
    );
  }

  // Edit Output mode
  if (mode === MODES.EDIT_OUTPUT) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.navBar}>
          <Text style={s.navTitle}>Review Output</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={s.label}>Title</Text>
          <TextInput style={s.input} value={title} onChangeText={setTitle} />
          <Text style={[s.label, { marginTop: 20 }]}>Extracted Text</Text>
          <TextInput 
            style={[s.input, { height: 300, textAlignVertical: "top", fontSize: 14 }]} 
            multiline 
            value={extractedText} 
            onChangeText={setExtractedText} 
          />
        </ScrollView>
        <View style={[s.bottomAction, { flexDirection: "row", gap: 12 }]}>
          <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: "#1E1A4A", borderWidth: 1, borderColor: "#2D266B" }]} onPress={saveDocs} disabled={savingEdit}>
            {savingEdit ? <ActivityIndicator color="#F8F6F0" /> : <Text style={[s.btnText, { color: "#F8F6F0" }]}>Save to Docs</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={fetchJoinedChannels} disabled={savingEdit}>
            <Text style={s.btnText}>Push to Channel</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={showChannelSelect} animationType="fade" transparent>
          <View style={s.modalOverlay}>
            <View style={s.createModal}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
                <Text style={s.createModalTitle}>Select Channel</Text>
                <TouchableOpacity onPress={() => setShowChannelSelect(false)}><Ionicons name="close" size={24} color="#F5A623" /></TouchableOpacity>
              </View>
              {joinedChannels.length === 0 ? (
                <Text style={{ color: "#7A6DC4", marginBottom: 20 }}>You haven't joined any channels yet.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 300 }}>
                  {joinedChannels.map(c => (
                    <TouchableOpacity key={c.id} style={s.channelRow} onPress={() => submitToChannel(c.id)} disabled={submittingToChannel}>
                      <Ionicons name="library" size={20} color="#7A6DC4" />
                      <Text style={s.channelName}>{c.name}</Text>
                      {submittingToChannel ? <ActivityIndicator size="small" color="#F5A623" /> : <Ionicons name="cloud-upload" size={20} color="#F5A623" />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // Idle mode
  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text style={s.screenLabel}>NoteHub</Text>
        <Text style={s.title}>Capture Notes</Text>
        <TouchableOpacity style={s.cameraBtn} onPress={openCamera}>
          <Ionicons name="camera" size={56} color="#F5A623" />
        </TouchableOpacity>
        <Text style={[s.title, { fontSize: 22, marginTop: 24, textAlign: "center" }]}>Start Capturing</Text>
        <Text style={[s.subtitle, { textAlign: "center" }]}>Take photos of your notes, slides, or textbooks.</Text>
        <View style={{ marginTop: 28, gap: 12 }}>
          {[
            { step: "1", icon: "camera-outline", label: "Take photos inside the app" },
            { step: "2", icon: "text-outline", label: "OCR extracts all text automatically" },
            { step: "3", icon: "document-text-outline", label: "Saved as a searchable PDF" },
          ].map(item => (
            <View key={item.step} style={s.stepCard}>
              <View style={s.stepNum}><Text style={{ color: "#0A0A0F", fontWeight: "bold" }}>{item.step}</Text></View>
              <Ionicons name={item.icon} size={20} color="#7A6DC4" style={{ marginRight: 10 }} />
              <Text style={{ color: "#D8D4F0", fontSize: 14, flex: 1 }}>{item.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  screenLabel: { fontSize: 12, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 },
  title: { fontSize: 30, fontWeight: "bold", color: "#F8F6F0" },
  subtitle: { fontSize: 15, color: "#7A6DC4", lineHeight: 24, marginTop: 8 },
  label: { fontSize: 12, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 },
  input: { backgroundColor: "#1E1A4A", color: "#F8F6F0", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, borderWidth: 1, borderColor: "#2D266B" },
  btn: { backgroundColor: "#F5A623", borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  btnText: { color: "#0A0A0F", fontWeight: "bold", fontSize: 16 },
  bottomAction: { padding: 20, borderTopWidth: 1, borderTopColor: "#1E1A4A" },
  navBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#1E1A4A" },
  navTitle: { color: "#F8F6F0", fontWeight: "bold", fontSize: 18 },
  removeBtn: { position: "absolute", top: -8, right: -8, backgroundColor: "#E85D75", borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  cameraBtn: { width: 140, height: 140, borderRadius: 70, backgroundColor: "#1E1A4A", borderWidth: 3, borderColor: "#F5A623", alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 32 },
  stepCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1E1A4A", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
  stepNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#F5A623", alignItems: "center", justifyContent: "center", marginRight: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end", padding: 20 },
  createModal: { backgroundColor: "#1E1A4A", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#2D266B", paddingBottom: 40 },
  createModalTitle: { color: "#F8F6F0", fontSize: 20, fontWeight: "bold" },
  channelRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#0A0A0F", padding: 16, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: "#2D266B" },
  channelName: { color: "#F8F6F0", fontSize: 16, fontWeight: "600", flex: 1, marginLeft: 12 },
  cropHandle: { position: "absolute", width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  cropHandleInner: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#F5A623", borderWidth: 2, borderColor: "white" },
});

const cam = StyleSheet.create({
  topBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 52, paddingBottom: 16, backgroundColor: "rgba(0,0,0,0.5)" },
  iconBtn: { padding: 8 },
  badge: { backgroundColor: "rgba(245,166,35,0.9)", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  badgeText: { color: "#0A0A0F", fontWeight: "bold", fontSize: 13 },
  doneBtn: { backgroundColor: "#F5A623", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", paddingBottom: 48, paddingTop: 20, backgroundColor: "rgba(0,0,0,0.6)" },
  shutter: { width: 76, height: 76, borderRadius: 38, backgroundColor: "white", borderWidth: 5, borderColor: "#F5A623" },
});
