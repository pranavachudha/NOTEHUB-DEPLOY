import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, Modal, ScrollView, RefreshControl, StyleSheet, TextInput,
  Animated, PanResponder, LayoutAnimation
} from "react-native";
import { TouchableOpacity as GHTouchableOpacity, GestureHandlerRootView } from "react-native-gesture-handler";
import DraggableFlatList, { ScaleDecorator } from "react-native-draggable-flatlist";
import React, { useState, useCallback, useRef, memo } from "react";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useAppAlert } from "../../components/AppAlert";
import api from "../../services/api";

export default function ChannelsScreen() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  
  const [channelNotes, setChannelNotes] = useState({ approved: [], my_submissions: [] });
  const [adminQueue, setAdminQueue] = useState([]);
  const [members, setMembers] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [activeTab, setActiveTab] = useState("approved"); // approved | my_submissions | queue | members

  // Pagination & Reorder states
  const [notesOffset, setNotesOffset] = useState(0);
  const [hasMoreNotes, setHasMoreNotes] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  // Notification & Invite states
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  // Note Editing states
  const [isEditingAll, setIsEditingAll] = useState(false);
  const [modifiedNotes, setModifiedNotes] = useState({}); // submission_id -> text
  const [savingBulk, setSavingBulk] = useState(false);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [isEditingChannel, setIsEditingChannel] = useState(false);
  const [editChannelName, setEditChannelName] = useState("");
  const [editChannelDesc, setEditChannelDesc] = useState("");
  const [savingChannelEdit, setSavingChannelEdit] = useState(false);

  const { show, element } = useAppAlert();

  useFocusEffect(useCallback(() => { loadChannels(); loadNotifications(); }, []));

  async function loadNotifications() {
    try {
      const res = await api.get("/notifications");
      setNotifications(res.data);
    } catch {}
  }

  async function loadChannels(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await api.get("/channels");
      setChannels(res.data);
    } catch { if (!silent) show("Error", "Could not load channels."); }
    finally { setLoading(false); setRefreshing(false); }
  }

  async function joinChannel(channelId) {
    try {
      await api.post(`/channels/${channelId}/join`);
      loadChannels(true);
      show("Joined", "You have joined the channel.");
    } catch { show("Error", "Could not join channel."); }
  }

  async function openChannel(channel) {
    setSelectedChannel(channel);
    setLoadingDetails(true);
    setActiveTab("approved");
    setIsReordering(false);
    setNotesOffset(0);
    setHasMoreNotes(false);
    try {
      const res = await api.get(`/channels/${channel.id}/notes?limit=20&offset=0`);
      setChannelNotes({ approved: res.data.approved, my_submissions: res.data.my_submissions });
      setHasMoreNotes(res.data.has_more);
      
      if (channel.is_admin || channel.role === 'moderator') {
        const qRes = await api.get(`/channels/${channel.id}/queue`);
        setAdminQueue(qRes.data);
        const mRes = await api.get(`/channels/${channel.id}/members`);
        setMembers(mRes.data);
      }
    } catch { show("Error", "Could not load channel details."); }
    finally { setLoadingDetails(false); }
  }

  async function loadMoreNotes() {
    if (!hasMoreNotes || loadingMore || !selectedChannel) return;
    setLoadingMore(true);
    try {
      const nextOffset = notesOffset + 20;
      const res = await api.get(`/channels/${selectedChannel.id}/notes?limit=20&offset=${nextOffset}`);
      setChannelNotes(prev => ({ ...prev, approved: [...prev.approved, ...res.data.approved] }));
      setHasMoreNotes(res.data.has_more);
      setNotesOffset(nextOffset);
    } catch {}
    finally { setLoadingMore(false); }
  }

  async function bulkSaveNotes() {
    setSavingBulk(true);
    try {
      const updates = channelNotes.approved.map(n => ({
        submission_id: n.submission_id,
        extracted_text: modifiedNotes[n.submission_id]?.text !== undefined ? modifiedNotes[n.submission_id].text : n.extracted_text,
        heading: modifiedNotes[n.submission_id]?.heading !== undefined ? modifiedNotes[n.submission_id].heading : n.heading,
        subheading: modifiedNotes[n.submission_id]?.subheading !== undefined ? modifiedNotes[n.submission_id].subheading : n.subheading
      }));

      await api.post(`/channels/${selectedChannel.id}/notes/bulk-update`, { updates });
      
      setChannelNotes(prev => ({
        ...prev,
        approved: prev.approved.map(n => {
          const mod = modifiedNotes[n.submission_id];
          if (!mod) return n;
          return {
            ...n,
            extracted_text: mod.text !== undefined ? mod.text : n.extracted_text,
            heading: mod.heading !== undefined ? mod.heading : n.heading,
            subheading: mod.subheading !== undefined ? mod.subheading : n.subheading
          };
        })
      }));
      setIsEditingAll(false);
      setModifiedNotes({});
      show("Saved", "All changes saved successfully.");
    } catch { show("Error", "Could not save changes."); }
    finally { setSavingBulk(false); }
  }

  async function saveChannelEdit() {
    if (!editChannelName.trim()) return show("Error", "Channel name is required.");
    setSavingChannelEdit(true);
    try {
      await api.put(`/channels/${selectedChannel.id}`, { name: editChannelName.trim(), description: editChannelDesc });
      setSelectedChannel(prev => ({ ...prev, name: editChannelName.trim(), description: editChannelDesc }));
      loadChannels(true);
      setIsEditingChannel(false);
      show("Saved", "Channel details updated.");
    } catch { show("Error", "Could not update channel."); }
    finally { setSavingChannelEdit(false); }
  }

  async function downloadChannelPDF() {
    if (!selectedChannel) return;
    setDownloadingPDF(true);
    try {
      const res = await api.get(`/channels/${selectedChannel.id}/export-pdf`);
      const { pdf_base64, filename } = res.data;
      const fileUri = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, pdf_base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(fileUri);
    } catch (err) {
      console.error(err);
      show("Error", "Could not generate PDF.");
    } finally { setDownloadingPDF(false); }
  }

  async function leaveOrDeleteChannel() {
    if (!selectedChannel) return;
    
    const isOwner = selectedChannel.is_admin;
    const title = isOwner ? "Delete/Leave Channel" : "Leave Channel";
    const message = isOwner 
      ? "As the owner, if you leave, ownership will be transferred to a moderator or member. If no one else is in the channel, it will be deleted permanently. Are you sure?"
      : "Are you sure you want to leave this channel?";

    show(title, message, [
      { text: "Cancel", style: "cancel" },
      { 
        text: isOwner ? "Leave & Transfer" : "Leave", 
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/channels/${selectedChannel.id}`);
            setSelectedChannel(null);
            loadChannels(true);
            show("Success", "Action completed successfully.");
          } catch {
            show("Error", "Could not complete action.");
          }
        }
      }
    ]);
  }

  async function saveReorder() {
    setSavingOrder(true);
    try {
      const submission_ids = channelNotes.approved.map(n => n.submission_id);
      await api.put(`/channels/${selectedChannel.id}/notes/reorder`, { submission_ids });
      setIsReordering(false);
      show("Saved", "Channel order updated successfully.");
    } catch { show("Error", "Could not save new order."); }
    finally { setSavingOrder(false); }
  }

  function moveNote(index, direction) {
    const newNotes = [...channelNotes.approved];
    const newPos = index + direction;
    if (newPos < 0 || newPos >= newNotes.length) return;
    const [moved] = newNotes.splice(index, 1);
    newNotes.splice(newPos, 0, moved);
    setChannelNotes(prev => ({ ...prev, approved: newNotes }));
  }

  async function handleAcceptInvite(notifId) {
    try {
      await api.post(`/notifications/${notifId}/accept`);
      loadNotifications();
      loadChannels(true);
      show("Accepted", "You have joined the channel.");
    } catch { show("Error", "Could not accept invite."); }
  }

  async function handleDeclineInvite(notifId) {
    try {
      await api.post(`/notifications/${notifId}/decline`);
      loadNotifications();
    } catch { show("Error", "Could not decline invite."); }
  }

  async function removeMember(targetUserId) {
    show("Remove Member", "Are you sure you want to remove this member?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", onPress: async () => {
        try {
          await api.delete(`/channels/${selectedChannel.id}/members/${targetUserId}`);
          setMembers(prev => prev.filter(m => m.user_id !== targetUserId));
        } catch { show("Error", "Could not remove member."); }
      }}
    ]);
  }

  async function searchUsers(q) {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    try {
      const res = await api.get(`/users/search?q=${encodeURIComponent(q)}`);
      setSearchResults(res.data);
    } catch {}
  }

  async function sendInvite(userId) {
    try {
      await api.post(`/channels/${selectedChannel.id}/invites`, { user_id: userId });
      show("Sent", "Invite sent successfully.");
      setShowInviteModal(false);
    } catch (err) { show("Error", err.response?.data?.detail || "Could not send invite."); }
  }

  async function changeRole(userId, newRole) {
    try {
      await api.put(`/channels/${selectedChannel.id}/members/${userId}/role`, { role: newRole });
      const mRes = await api.get(`/channels/${selectedChannel.id}/members`);
      setMembers(mRes.data);
    } catch (err) { show("Error", err.response?.data?.detail || "Could not change role."); }
  }

  async function handleApprove(subId) {
    try {
      await api.post(`/channels/submissions/${subId}/approve`);
      show("Approved", "The note has been published to the channel.");
      openChannel(selectedChannel); // reload
    } catch { show("Error", "Failed to approve."); }
  }

  async function handleReject(subId) {
    try {
      await api.post(`/channels/submissions/${subId}/reject`);
      show("Rejected", "The note submission was rejected.");
      openChannel(selectedChannel); // reload
    } catch { show("Error", "Failed to reject."); }
  }

  async function handleDeleteNote(submissionId) {
    show("Delete Note", "Are you sure you want to delete this note from the channel?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await api.delete(`/channels/${selectedChannel.id}/notes/${submissionId}`);
          setChannelNotes(prev => ({
            ...prev,
            approved: prev.approved.filter(n => n.submission_id !== submissionId)
          }));
          show("Deleted", "Note removed from the channel.");
        } catch { show("Error", "Could not delete note."); }
      }}
    ]);
  }

  const renderNoteItem = useCallback(({ item, drag, isActive }) => {
    return (
      <NoteItem 
        note={item} 
        drag={drag} 
        isActive={isActive} 
        isReordering={isReordering}
        isEditingAll={isEditingAll}
        onDelete={handleDeleteNote}
        onPress={() => {
          setSelectedNote(item);
          setShowNoteModal(true);
        }}
        selectedChannel={selectedChannel}
        modifiedNotes={modifiedNotes}
        setModifiedNotes={setModifiedNotes}
      />
    );
  }, [isReordering, isEditingAll, selectedChannel, handleDeleteNote, modifiedNotes, setModifiedNotes]);

  if (loading) {
    return (
      <SafeAreaView style={[s.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color="#F5A623" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      {element}
      <View style={s.header}>
        <View>
          <Text style={s.screenLabel}>NoteHub</Text>
          <Text style={s.title}>Channels</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity onPress={() => setShowNotifications(true)} style={s.bellBtn}>
            <Ionicons name="notifications" size={22} color={notifications.length > 0 ? "#F5A623" : "#7A6DC4"} />
            {notifications.length > 0 && <View style={s.bellBadge}><Text style={s.bellBadgeText}>{notifications.length}</Text></View>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowCreate(true)} style={s.createBtn}>
            <Ionicons name="add" size={20} color="#0A0A0F" />
            <Text style={s.createBtnText}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={channels}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadChannels(true); }} tintColor="#F5A623" />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => item.is_member ? openChannel(item) : joinChannel(item.id)} style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.cardIcon}>
                <Ionicons name="library" size={20} color="#F5A623" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={s.cardDesc} numberOfLines={2}>{item.description}</Text>
              </View>
            </View>
            <View style={s.cardFooter}>
              {item.is_admin && <Text style={s.adminBadge}>Admin</Text>}
              {!item.is_member ? (
                <View style={s.joinBtn}>
                  <Text style={s.joinText}>Join Channel</Text>
                </View>
              ) : (
                <Text style={s.viewText}>Tap to open</Text>
              )}
            </View>
          </TouchableOpacity>
        )}
      />

      <CreateChannelModal visible={showCreate} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadChannels(true); }} showAlert={show} />

      <Modal visible={!!selectedChannel} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedChannel(null)}>
        {selectedChannel && (
          <SafeAreaView style={s.container}>
            {element}
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => { setSelectedChannel(null); setIsEditingChannel(false); }} style={{ marginRight: 12 }}><Ionicons name="arrow-back" size={24} color="#F5A623" /></TouchableOpacity>
              <View style={{ flex: 1 }}>
                {isEditingChannel ? (
                  <TextInput 
                    style={[s.modalTitle, s.editInput]} 
                    value={editChannelName} 
                    onChangeText={setEditChannelName} 
                    placeholder="Channel Name"
                    placeholderTextColor="#4a4460"
                  />
                ) : (
                  <>
                    <Text style={s.modalTitle} numberOfLines={1}>{selectedChannel.name}</Text>
                    <Text style={s.memberEmail} numberOfLines={1}>{selectedChannel.description}</Text>
                  </>
                )}
              </View>
              
              {selectedChannel.is_admin && (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {isEditingChannel && (
                    <TouchableOpacity onPress={() => setIsEditingChannel(false)} style={{ padding: 8 }}>
                      <Ionicons name="close-circle-outline" size={26} color="#E85D75" />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity 
                    onPress={() => {
                      if (isEditingChannel) saveChannelEdit();
                      else {
                        setEditChannelName(selectedChannel.name);
                        setEditChannelDesc(selectedChannel.description || "");
                        setIsEditingChannel(true);
                      }
                    }} 
                    style={{ padding: 8 }}
                  >
                    {savingChannelEdit ? <ActivityIndicator size="small" color="#F5A623" /> : (
                      <Ionicons name={isEditingChannel ? "checkmark-circle" : "pencil"} size={24} color="#F5A623" />
                    )}
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity onPress={downloadChannelPDF} disabled={downloadingPDF || isEditingChannel} style={{ padding: 8, opacity: isEditingChannel ? 0.3 : 1 }}>
                {downloadingPDF ? <ActivityIndicator size="small" color="#F5A623" /> : <Ionicons name="download-outline" size={24} color="#F5A623" />}
              </TouchableOpacity>
              <TouchableOpacity onPress={leaveOrDeleteChannel} disabled={isEditingChannel} style={{ padding: 8, opacity: isEditingChannel ? 0.3 : 1 }}>
                <Ionicons name={selectedChannel.is_admin ? "trash-outline" : "log-out-outline"} size={24} color="#E85D75" />
              </TouchableOpacity>
            </View>

            <View style={s.tabs}>
              <TouchableOpacity onPress={() => setActiveTab("approved")} style={[s.tab, activeTab === "approved" && s.tabActive]}>
                <Text style={[s.tabText, activeTab === "approved" && s.tabTextActive]}>Approved</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setActiveTab("my_submissions")} style={[s.tab, activeTab === "my_submissions" && s.tabActive]}>
                <Text style={[s.tabText, activeTab === "my_submissions" && s.tabTextActive]}>My Submissions</Text>
              </TouchableOpacity>
              {(selectedChannel.is_admin || selectedChannel.role === 'moderator') && (
                <>
                  <TouchableOpacity onPress={() => setActiveTab("queue")} style={[s.tab, activeTab === "queue" && s.tabActive]}>
                    <Text style={[s.tabText, activeTab === "queue" && s.tabTextActive]}>Queue ({adminQueue.length})</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setActiveTab("members")} style={[s.tab, activeTab === "members" && s.tabActive]}>
                    <Text style={[s.tabText, activeTab === "members" && s.tabTextActive]}>Members</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {loadingDetails ? (
              <ActivityIndicator color="#F5A623" style={{ marginTop: 40 }} />
            ) : activeTab === "approved" ? (
              <View style={{ flex: 1 }}>
                {(selectedChannel?.is_admin || selectedChannel?.role === 'moderator') && (
                  <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 12 }}>
                    {isReordering ? (
                      <TouchableOpacity onPress={saveReorder} disabled={savingOrder} style={[s.createBtn, { backgroundColor: "#F5A623" }]}>
                        {savingOrder ? <ActivityIndicator size="small" color="#0A0A0F" /> : <Text style={s.createBtnText}>Save Order</Text>}
                      </TouchableOpacity>
                    ) : isEditingAll ? (
                      <TouchableOpacity onPress={bulkSaveNotes} disabled={savingBulk} style={[s.createBtn, { backgroundColor: "#F5A623" }]}>
                        {savingBulk ? <ActivityIndicator size="small" color="#0A0A0F" /> : <Text style={s.createBtnText}>Save Edits</Text>}
                      </TouchableOpacity>
                    ) : (
                      <>
                        <TouchableOpacity onPress={() => { setIsEditingAll(true); setModifiedNotes({}); }} style={[s.createBtn, { backgroundColor: "#2D266B" }]}>
                          <Ionicons name="create-outline" size={16} color="#F5A623" />
                          <Text style={[s.createBtnText, { color: "#F5A623" }]}>Edit Notes</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setIsReordering(true)} style={[s.createBtn, { backgroundColor: "#2D266B" }]}>
                          <Ionicons name="swap-vertical" size={16} color="#F5A623" />
                          <Text style={[s.createBtnText, { color: "#F5A623" }]}>Reorder</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
                
                <View style={{ flex: 1 }}>
                  <GestureHandlerRootView style={{ flex: 1 }}>
                    <DraggableFlatList
                      data={channelNotes.approved}
                      keyExtractor={note => note.submission_id}
                      onDragEnd={({ data }) => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setChannelNotes(prev => ({ ...prev, approved: data }));
                      }}
                      initialNumToRender={8}
                      maxToRenderPerBatch={10}
                      windowSize={5}
                      removeClippedSubviews={true}
                      onEndReached={isReordering ? null : loadMoreNotes}
                      onEndReachedThreshold={0.5}
                      ListFooterComponent={loadingMore ? <ActivityIndicator color="#F5A623" style={{ marginVertical: 10 }} /> : null}
                      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                      renderItem={renderNoteItem}
                      ListEmptyComponent={<Text style={s.emptyState}>Nothing to see here.</Text>}
                    />
                  </GestureHandlerRootView>
                </View>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                {activeTab === "my_submissions" && channelNotes.my_submissions.map(note => (
                  <View key={note.submission_id} style={s.noteCard}>
                    <View style={s.rowBetween}>
                      <Text style={s.noteTitle}>{note.title}</Text>
                      <Text style={[s.statusBadge, note.status === "pending" ? s.statusPending : s.statusRejected]}>
                        {note.status.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={s.notePreview} numberOfLines={2}>{note.extracted_text}</Text>
                  </View>
                ))}

                {activeTab === "queue" && (selectedChannel.is_admin || selectedChannel.role === 'moderator') && adminQueue.map(note => (
                  <View key={note.submission_id} style={s.noteCard}>
                    <Text style={s.noteTitle}>{note.title}</Text>
                    <Text style={s.noteAuthor}>Submitted by {note.author_name}</Text>
                    <Text style={s.notePreview} numberOfLines={4}>{note.extracted_text}</Text>
                    <View style={s.actionRow}>
                      <TouchableOpacity onPress={() => handleReject(note.submission_id)} style={[s.actionBtn, s.rejectBtn]}>
                        <Text style={s.rejectText}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleApprove(note.submission_id)} style={[s.actionBtn, s.approveBtn]}>
                        <Text style={s.approveText}>Approve</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}

                {activeTab === "members" && (selectedChannel.is_admin || selectedChannel.role === 'moderator') && (
                  <View>
                    <TouchableOpacity onPress={() => setShowInviteModal(true)} style={[s.createBtn, { marginBottom: 16, alignSelf: "flex-start" }]}>
                      <Ionicons name="person-add" size={16} color="#0A0A0F" />
                      <Text style={s.createBtnText}>Invite User</Text>
                    </TouchableOpacity>
                    {members.filter(m => m.user_id !== selectedChannel.admin_id).map(m => (
                      <View key={m.user_id} style={s.memberRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.memberName}>{m.name}</Text>
                          <Text style={s.memberEmail}>{m.email}</Text>
                        </View>
                        {selectedChannel.is_admin ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                            <TouchableOpacity 
                              style={s.roleBtn}
                              onPress={() => changeRole(m.user_id, m.role === 'member' ? 'moderator' : 'member')}
                            >
                              <Text style={s.roleBtnText}>{m.role.toUpperCase()}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => removeMember(m.user_id)} style={s.removeBtn}>
                              <Ionicons name="trash-outline" size={20} color="#E85D75" />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <Text style={s.roleBadge}>{m.role.toUpperCase()}</Text>
                        )}
                      </View>
                    ))}
                  </View>
                )}
                
                {((activeTab === "my_submissions" && channelNotes.my_submissions.length === 0) ||
                  (activeTab === "queue" && adminQueue.length === 0) ||
                  (activeTab === "members" && members.length === 0)) && (
                  <Text style={s.emptyState}>Nothing to see here.</Text>
                )}
              </ScrollView>
            )}
          </SafeAreaView>
        )}
      </Modal>

      {/* Notifications Modal */}
      <Modal visible={showNotifications} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNotifications(false)}>
        <SafeAreaView style={s.container}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowNotifications(false)} style={{ marginRight: 12 }}><Ionicons name="close" size={22} color="#F5A623" /></TouchableOpacity>
            <Text style={s.modalTitle}>Notifications</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {notifications.length === 0 && <Text style={s.emptyState}>No new notifications.</Text>}
            {notifications.map(n => (
              <View key={n.id} style={s.notifCard}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={s.notifTitle}>Channel Invite</Text>
                  <Text style={s.notifText}><Text style={{ fontWeight: "bold", color: "#F8F6F0" }}>{n.sender_name}</Text> invited you to join <Text style={{ fontWeight: "bold", color: "#F5A623" }}>{n.channel_name}</Text>.</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity onPress={() => handleDeclineInvite(n.id)} style={[s.notifBtn, { backgroundColor: "rgba(232,93,117,0.15)" }]}><Ionicons name="close" size={18} color="#E85D75" /></TouchableOpacity>
                  <TouchableOpacity onPress={() => handleAcceptInvite(n.id)} style={[s.notifBtn, { backgroundColor: "#F5A623" }]}><Ionicons name="checkmark" size={18} color="#0A0A0F" /></TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Invite Modal */}
      <Modal visible={showInviteModal} animationType="fade" transparent>
        <View style={s.modalOverlay}>
          <View style={s.createModal}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={s.createModalTitle}>Invite User</Text>
              <TouchableOpacity onPress={() => setShowInviteModal(false)}><Ionicons name="close" size={24} color="#F5A623" /></TouchableOpacity>
            </View>
            <TextInput style={s.input} placeholder="Search by name or email" placeholderTextColor="#4a4460" value={searchQuery} onChangeText={searchUsers} autoFocus />
            <ScrollView style={{ maxHeight: 200 }}>
              {searchResults.map(u => (
                <View key={u.id} style={s.searchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.memberName}>{u.name}</Text>
                    <Text style={s.memberEmail}>{u.email}</Text>
                  </View>
                  <TouchableOpacity onPress={() => sendInvite(u.id)} style={s.sendInviteBtn}><Text style={s.sendInviteText}>Invite</Text></TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

function CreateChannelModal({ visible, onClose, onCreated, showAlert }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return showAlert("Error", "Channel name is required.");
    setSaving(true);
    try {
      await api.post("/channels/create", { name });
      onCreated();
      setName("");
    } catch { showAlert("Error", "Could not create channel."); }
    finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={s.createModal}>
          <Text style={s.createModalTitle}>Create Channel</Text>
          <TextInput style={s.input} placeholder="Channel Name (e.g. CS 101)" placeholderTextColor="#4a4460" value={name} onChangeText={setName} />
          <View style={s.modalActions}>
            <TouchableOpacity onPress={onClose} style={s.cancelBtn}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={handleCreate} style={s.saveBtn} disabled={saving}>
              {saving ? <ActivityIndicator color="#0A0A0F" /> : <Text style={s.saveText}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  screenLabel: { fontSize: 11, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 2, marginBottom: 2 },
  title: { fontSize: 28, fontWeight: "bold", color: "#F8F6F0" },
  createBtn: { backgroundColor: "#F5A623", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  createBtnText: { color: "#0A0A0F", fontWeight: "bold", marginLeft: 4 },
  card: { backgroundColor: "#1E1A4A", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#2D266B" },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  cardIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#120F2E", alignItems: "center", justifyContent: "center", marginRight: 10 },
  cardTitle: { color: "#F8F6F0", fontWeight: "bold", fontSize: 16, marginBottom: 4 },
  cardDesc: { color: "#7A6DC4", fontSize: 13, lineHeight: 18 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: "#2D266B", paddingTop: 12, marginTop: 4 },
  adminBadge: { color: "#E85D75", fontSize: 11, fontWeight: "bold", backgroundColor: "rgba(232,93,117,0.15)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  joinBtn: { backgroundColor: "#3D348B", paddingHorizontal: 16, paddingVertical: 6, borderRadius: 12 },
  joinText: { color: "#F8F6F0", fontWeight: "bold", fontSize: 13 },
  viewText: { color: "#F5A623", fontSize: 13, fontWeight: "600" },
  modalHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#1E1A4A" },
  modalTitle: { color: "#F8F6F0", fontWeight: "bold", fontSize: 18, flex: 1 },
  editInput: { backgroundColor: "#120F2E", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "#2D266B", color: "#F8F6F0" },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#1E1A4A" },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: "#F5A623" },
  tabText: { color: "#7A6DC4", fontWeight: "600", fontSize: 13 },
  tabTextActive: { color: "#F5A623" },
  noteCard: { backgroundColor: "#1E1A4A", padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: "#2D266B" },
  noteTitle: { color: "#F8F6F0", fontWeight: "bold", fontSize: 16, marginBottom: 4 },
  noteAuthor: { color: "#F5A623", fontSize: 12, marginBottom: 8 },
  notePreview: { color: "#7A6DC4", fontSize: 13, lineHeight: 20 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  statusBadge: { fontSize: 10, fontWeight: "bold", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusPending: { color: "#F5A623", backgroundColor: "rgba(245,166,35,0.15)" },
  statusRejected: { color: "#E85D75", backgroundColor: "rgba(232,93,117,0.15)" },
  actionRow: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#2D266B" },
  actionBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  rejectBtn: { backgroundColor: "rgba(232,93,117,0.1)" },
  rejectText: { color: "#E85D75", fontWeight: "bold" },
  approveBtn: { backgroundColor: "#F5A623" },
  approveText: { color: "#0A0A0F", fontWeight: "bold" },
  emptyState: { color: "#4a4460", textAlign: "center", marginTop: 40, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 },
  createModal: { backgroundColor: "#1E1A4A", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#2D266B" },
  createModalTitle: { color: "#F8F6F0", fontSize: 20, fontWeight: "bold", marginBottom: 16 },
  input: { backgroundColor: "#0A0A0F", color: "#F8F6F0", borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 12, borderWidth: 1, borderColor: "#2D266B" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 8 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  cancelText: { color: "#7A6DC4", fontWeight: "bold" },
  saveBtn: { backgroundColor: "#F5A623", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 },
  saveText: { color: "#0A0A0F", fontWeight: "bold" },
  bellBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1E1A4A", justifyContent: "center", alignItems: "center" },
  bellBadge: { position: "absolute", top: -2, right: -2, backgroundColor: "#E85D75", borderRadius: 10, minWidth: 18, height: 18, justifyContent: "center", alignItems: "center", paddingHorizontal: 4 },
  bellBadgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1E1A4A" },
  memberName: { color: "#F8F6F0", fontWeight: "bold", fontSize: 15 },
  memberEmail: { color: "#7A6DC4", fontSize: 13 },
  roleBtn: { backgroundColor: "#2D266B", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  roleBtnText: { color: "#F5A623", fontSize: 10, fontWeight: "bold" },
  removeBtn: { padding: 4 },
  roleBadge: { color: "#4a4460", fontSize: 10, fontWeight: "bold", paddingHorizontal: 10, paddingVertical: 6 },
  notifCard: { backgroundColor: "#1E1A4A", padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: "#2D266B", flexDirection: "row", alignItems: "center" },
  notifTitle: { color: "#F5A623", fontWeight: "bold", fontSize: 12, textTransform: "uppercase", marginBottom: 4 },
  notifText: { color: "#7A6DC4", fontSize: 14, lineHeight: 20 },
  notifBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },
  searchRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1E1A4A" },
  sendInviteBtn: { backgroundColor: "#F5A623", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  sendInviteText: { color: "#0A0A0F", fontWeight: "bold", fontSize: 12 },
});

const NoteItem = memo(({ note, drag, isActive, isReordering, isEditingAll, onDelete, onPress, selectedChannel, modifiedNotes, setModifiedNotes }) => {
  return (
    <ScaleDecorator>
      <TouchableOpacity
        onLongPress={drag}
        disabled={!isReordering}
        onPress={onPress}
        style={[
          s.card,
          {
            backgroundColor: isActive ? "#3D348B" : "#1E1A4A",
            borderColor: isActive ? "#F5A623" : "#2D266B",
            borderBottomColor: isReordering ? (isActive ? "#F5A623" : "#2D266B") : "#1E1A4A",
            flexDirection: "row",
            alignItems: "flex-start",
            elevation: isActive ? 10 : 0,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 5 },
            shadowOpacity: isActive ? 0.3 : 0,
            shadowRadius: 10,
            paddingVertical: 12,
            paddingHorizontal: 16,
            marginVertical: isReordering ? 4 : 0,
            borderRadius: isReordering ? 12 : 0,
          }
        ]}
      >
        {isReordering && (
          <View style={{ marginRight: 12, padding: 10, backgroundColor: isActive ? "rgba(0,0,0,0.1)" : "#2D266B", borderRadius: 8 }}>
            <Ionicons name="menu" size={20} color={isActive ? "#F5A623" : "#7A6DC4"} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          {isEditingAll ? (
            <View style={{ gap: 8 }}>
              <TextInput
                placeholder="Heading"
                placeholderTextColor="#4a4460"
                style={{ color: "#F5A623", fontSize: 18, fontWeight: "bold", backgroundColor: "#120F2E", padding: 8, borderRadius: 8 }}
                value={modifiedNotes[note.submission_id]?.heading !== undefined ? modifiedNotes[note.submission_id].heading : (note.heading || "")}
                onChangeText={(text) => setModifiedNotes(prev => ({ ...prev, [note.submission_id]: { ...(prev[note.submission_id] || {}), heading: text } }))}
              />
              <TextInput
                placeholder="Subheading"
                placeholderTextColor="#4a4460"
                style={{ color: "#7A6DC4", fontSize: 14, backgroundColor: "#120F2E", padding: 8, borderRadius: 8 }}
                value={modifiedNotes[note.submission_id]?.subheading !== undefined ? modifiedNotes[note.submission_id].subheading : (note.subheading || "")}
                onChangeText={(text) => setModifiedNotes(prev => ({ ...prev, [note.submission_id]: { ...(prev[note.submission_id] || {}), subheading: text } }))}
              />
              <TextInput
                placeholder="Content"
                placeholderTextColor="#4a4460"
                style={{ color: "#F8F6F0", fontSize: 16, lineHeight: 26, backgroundColor: "#120F2E", padding: 8, borderRadius: 8 }}
                value={modifiedNotes[note.submission_id]?.text !== undefined ? modifiedNotes[note.submission_id].text : note.extracted_text}
                onChangeText={(text) => setModifiedNotes(prev => ({ ...prev, [note.submission_id]: { ...(prev[note.submission_id] || {}), text: text } }))}
                multiline
              />
            </View>
          ) : (
            <View>
              {note.heading && <Text style={{ color: "#F5A623", fontSize: 18, fontWeight: "bold", marginBottom: 2 }}>{note.heading}</Text>}
              {note.subheading && <Text style={{ color: "#7A6DC4", fontSize: 14, marginBottom: 8 }}>{note.subheading}</Text>}
              <Text style={{ color: "#F8F6F0", fontSize: 16, lineHeight: 26 }} numberOfLines={isReordering ? 3 : undefined}>
                {note.extracted_text}
              </Text>
            </View>
          )}
          <Text style={{ color: "#7A6DC4", fontSize: 12, marginTop: 4 }}>By {note.author_name}</Text>
        </View>

        {(selectedChannel.is_admin || selectedChannel.role === 'moderator') && isEditingAll && !isReordering && (
          <TouchableOpacity onPress={() => onDelete(note.submission_id)} style={{ padding: 8 }}>
            <Ionicons name="trash-outline" size={20} color="#E85D75" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </ScaleDecorator>
  );
});
