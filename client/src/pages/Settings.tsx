import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Key, Plus, Settings as SettingsIcon, Tag, Trash2, User, Users, Phone, Mail, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import {
  API_BASE_URL,
  getMyProfile,
  updateMyProfile,
  updateMemberProfile,
  getHouseholds,
  getHouseholdMembers,
  getBillGrouping,
  saveBillGrouping,
  type UserProfile,
  type HouseholdMember,
  type BillGroup,
  type BillGroupingSettings,
} from '../services/api';
import type { Household } from '../types';

const MCP_URL = `${API_BASE_URL}/mcp`;

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
      <p className="text-sm font-medium text-gray-700 mb-1">{label}</p>
      <div className="flex gap-2">
        <code className="text-xs bg-white p-2 rounded border flex-1 break-all">{value}</code>
        <button
          onClick={() => navigator.clipboard.writeText(value)}
          className="p-2 bg-gray-200 hover:bg-gray-300 rounded"
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  isMe,
  canEdit,
  onSaved,
}: {
  member: HouseholdMember;
  isMe: boolean;
  canEdit: boolean;
  onSaved: (updated: HouseholdMember) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(member.name);
  const [editPhone, setEditPhone] = useState(member.phone);
  const [editEmail, setEditEmail] = useState(member.email);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await updateMemberProfile(member.uid, { name: editName, phone: editPhone, email: editEmail });
      onSaved({ ...member, name: updated.name, phone: updated.phone || '', email: updated.email || '' });
      setEditing(false);
    } catch {
      setError('Kunde inte spara');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-indigo-200 text-indigo-800 flex items-center justify-center text-sm font-bold shrink-0">
            {editName ? editName[0].toUpperCase() : '?'}
          </div>
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Namn"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="email"
              value={editEmail}
              onChange={e => setEditEmail(e.target.value)}
              placeholder="E-postadress"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="tel"
              value={editPhone}
              onChange={e => setEditPhone(e.target.value)}
              placeholder="Telefon"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 justify-end">
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button
            onClick={() => setEditing(false)}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1"
          >
            Avbryt
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Sparar…' : 'Spara'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border ${isMe ? 'border-indigo-200 bg-indigo-50' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${isMe ? 'bg-indigo-200 text-indigo-800' : 'bg-gray-200 text-gray-700'}`}>
          {member.name ? member.name[0].toUpperCase() : '?'}
        </div>
        <div>
          <p className="font-medium text-gray-900 text-sm">
            {member.name || '(inget namn)'}
            {isMe && <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">Du</span>}
          </p>
          <p className="text-xs text-gray-500 capitalize">{member.role}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-0.5 text-xs text-gray-500 sm:text-right">
          {member.email && (
            <span className="flex items-center gap-1 sm:justify-end">
              <Mail className="h-3 w-3" />{member.email}
            </span>
          )}
          {member.phone && (
            <span className="flex items-center gap-1 sm:justify-end">
              <Phone className="h-3 w-3" />{member.phone}
            </span>
          )}
          {!member.email && !member.phone && (
            <span className="text-gray-400 italic">Ingen kontaktinfo</span>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded px-2 py-1"
          >
            Redigera
          </button>
        )}
      </div>
    </div>
  );
}

type SettingsTab = 'profil' | 'gruppering' | 'mcp';

export default function Settings() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const [households, setHouseholds] = useState<Household[]>([]);
  const [membersByHousehold, setMembersByHousehold] = useState<Record<string, HouseholdMember[]>>({});
  const [expandedHousehold, setExpandedHousehold] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState<Record<string, boolean>>({});
  const [adminHouseholds, setAdminHouseholds] = useState<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<SettingsTab>('profil');
  const [billGroupingEnabled, setBillGroupingEnabled] = useState(false);
  const [billGroups, setBillGroups] = useState<BillGroup[]>([]);
  const [billGroupsLoading, setBillGroupsLoading] = useState(true);
  const [billGroupsSaving, setBillGroupsSaving] = useState(false);
  const [billGroupsMsg, setBillGroupsMsg] = useState('');

  useEffect(() => {
    getMyProfile()
      .then(p => {
        setProfile(p);
        setEditName(p.name);
        setEditPhone(p.phone || '');
        setEditEmail(p.email || '');
      })
      .catch(console.error)
      .finally(() => setProfileLoading(false));

    getHouseholds()
      .then(hs => {
        setHouseholds(hs);
        if (hs.length > 0) setExpandedHousehold(hs[0].id);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!expandedHousehold || membersByHousehold[expandedHousehold]) return;
    setMembersLoading(prev => ({ ...prev, [expandedHousehold]: true }));
    getHouseholdMembers(expandedHousehold)
      .then(members => {
        setMembersByHousehold(prev => ({ ...prev, [expandedHousehold]: members }));
        // Detect if logged-in user is admin in this household
        const me = members.find(m => m.email === profile?.email);
        if (me?.role === 'admin') {
          setAdminHouseholds(prev => new Set([...prev, expandedHousehold!]));
        }
      })
      .catch(console.error)
      .finally(() => setMembersLoading(prev => ({ ...prev, [expandedHousehold!]: false })));
  }, [expandedHousehold, membersByHousehold, profile?.email]);

  useEffect(() => {
    getBillGrouping()
      .then((s: BillGroupingSettings) => {
        setBillGroupingEnabled(s.enabled);
        setBillGroups(s.groups);
      })
      .catch(console.error)
      .finally(() => setBillGroupsLoading(false));
  }, []);

  const handleSaveProfile = async () => {
    setSaving(true);
    setSaveMessage('');
    try {
      const updated = await updateMyProfile({ name: editName, phone: editPhone, email: editEmail });
      setProfile(updated);
      setSaveMessage('Profil sparad!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch {
      setSaveMessage('Kunde inte spara. Försök igen.');
    } finally {
      setSaving(false);
    }
  };

  const addGroup = () =>
    setBillGroups((prev) => [...prev, { id: crypto.randomUUID(), label: '', patterns: [''] }]);

  const removeGroup = (id: string) =>
    setBillGroups((prev) => prev.filter((g) => g.id !== id));

  const updateGroupLabel = (id: string, label: string) =>
    setBillGroups((prev) => prev.map((g) => (g.id === id ? { ...g, label } : g)));

  const addPattern = (groupId: string) =>
    setBillGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, patterns: [...g.patterns, ''] } : g))
    );

  const updatePattern = (groupId: string, i: number, value: string) =>
    setBillGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const patterns = [...g.patterns];
        patterns[i] = value;
        return { ...g, patterns };
      })
    );

  const removePattern = (groupId: string, i: number) =>
    setBillGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, patterns: g.patterns.filter((_, idx) => idx !== i) } : g
      )
    );

  const handleSaveBillGrouping = async () => {
    setBillGroupsSaving(true);
    setBillGroupsMsg('');
    try {
      await saveBillGrouping({ enabled: billGroupingEnabled, groups: billGroups });
      setBillGroupsMsg('Sparat!');
      setTimeout(() => setBillGroupsMsg(''), 3000);
    } catch {
      setBillGroupsMsg('Kunde inte spara. Försök igen.');
    } finally {
      setBillGroupsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-5 w-5 mr-2" />
              Tillbaka
            </button>
            <h1 className="ml-4 text-xl font-bold text-gray-900 flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-indigo-600" />
              Inställningar
            </h1>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        <div className="flex bg-white rounded-xl shadow-sm border border-gray-200 p-1">
          {(['profil', 'gruppering', 'mcp'] as SettingsTab[]).map((tab) => {
            const labels: Record<SettingsTab, string> = {
              profil: 'Profil',
              gruppering: 'Räkninggruppering',
              mcp: 'MCP',
            };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                  activeTab === tab ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {activeTab === 'profil' && (<>
        {/* Profile section */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-semibold mb-5 flex items-center gap-2">
            <User className="h-5 w-5 text-indigo-600" />
            Min profil
          </h2>

          {profileLoading ? (
            <p className="text-gray-500 text-sm">Laddar profil…</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Mail className="h-4 w-4 inline mr-1 text-gray-400" />
                  E-postadress
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  placeholder="din@email.se"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">Används för e-postutskick. Påverkar inte din inloggning.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Visningsnamn
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Ditt namn"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">Måste matcha exakt med ditt namn i beräkningarna för att e-post ska skickas rätt.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Phone className="h-4 w-4 inline mr-1 text-gray-400" />
                  Telefonnummer
                </label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value)}
                  placeholder="+46 70 000 00 00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Sparar…' : 'Spara profil'}
                </button>
                {saveMessage && (
                  <span className={`text-sm ${saveMessage.includes('Kunde') ? 'text-red-600' : 'text-green-600'}`}>
                    {saveMessage}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Household members section */}
        {households.length > 0 && (
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-xl font-semibold mb-5 flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-600" />
              Hushållsmedlemmar
            </h2>

            <div className="space-y-3">
              {households.map(household => {
                const isExpanded = expandedHousehold === household.id;
                const members = membersByHousehold[household.id] || [];
                const isLoadingMembers = membersLoading[household.id];

                return (
                  <div key={household.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedHousehold(isExpanded ? null : household.id)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left"
                    >
                      <span className="font-medium text-gray-900">{household.name}</span>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>{Object.keys(household.members || {}).length} medlemmar</span>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-4 space-y-2">
                        {isLoadingMembers ? (
                          <p className="text-sm text-gray-500">Laddar medlemmar…</p>
                        ) : members.length === 0 ? (
                          <p className="text-sm text-gray-400">Inga medlemmar hittades.</p>
                        ) : (
                          members.map(member => (
                            <MemberRow
                              key={member.uid}
                              member={member}
                              isMe={member.email === profile?.email}
                              canEdit={adminHouseholds.has(household.id) && member.email !== profile?.email}
                              onSaved={updated => setMembersByHousehold(prev => ({
                                ...prev,
                                [household.id]: prev[household.id].map(m => m.uid === updated.uid ? updated : m),
                              }))}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        </>)}

        {activeTab === 'gruppering' && (
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
              <Tag className="h-5 w-5 text-indigo-600" />
              Räkninggruppering
            </h2>
            <p className="text-sm text-gray-500 mb-5">
              Gruppera räkningar med liknande namn till en gemensam post i Sankey-diagrammet.
              Varje grupp matchar räkningar vars namn innehåller minst ett av de angivna uttrycken (skiftlägesokänsligt).
            </p>

            {billGroupsLoading ? (
              <p className="text-sm text-gray-500">Laddar…</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-5 pb-5 border-b border-gray-100">
                  <input
                    id="grouping-toggle"
                    type="checkbox"
                    checked={billGroupingEnabled}
                    onChange={(e) => setBillGroupingEnabled(e.target.checked)}
                    className="h-4 w-4 rounded text-indigo-600 border-gray-300 focus:ring-indigo-500"
                  />
                  <label htmlFor="grouping-toggle" className="text-sm font-medium text-gray-700 cursor-pointer">
                    Aktivera gruppering i diagram
                  </label>
                </div>

                <div className="space-y-4">
                  {billGroups.map((group) => (
                    <div key={group.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={group.label}
                          onChange={(e) => updateGroupLabel(group.id, e.target.value)}
                          placeholder="Gruppnamn (t.ex. Bolån)"
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button
                          onClick={() => removeGroup(group.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                          title="Ta bort grupp"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-1.5 pl-1">
                        <p className="text-xs font-medium text-gray-500 mb-2">Matchar räkningar vars namn innehåller:</p>
                        {group.patterns.map((pattern, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={pattern}
                              onChange={(e) => updatePattern(group.id, i, e.target.value)}
                              placeholder="t.ex. Lån, SBAB, Nordea"
                              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <button
                              onClick={() => removePattern(group.id, i)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                              title="Ta bort matchning"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addPattern(group.id)}
                          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 mt-1"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Lägg till matchning
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={addGroup}
                    className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 hover:border-indigo-400 text-gray-500 hover:text-indigo-600 rounded-xl py-3 text-sm font-medium transition"
                  >
                    <Plus className="h-4 w-4" />
                    Ny grupp
                  </button>
                </div>

                <div className="flex items-center gap-3 mt-5 pt-5 border-t border-gray-100">
                  <button
                    onClick={handleSaveBillGrouping}
                    disabled={billGroupsSaving}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
                  >
                    <Save className="h-4 w-4" />
                    {billGroupsSaving ? 'Sparar…' : 'Spara gruppering'}
                  </button>
                  {billGroupsMsg && (
                    <span className={`text-sm ${billGroupsMsg.includes('Kunde') ? 'text-red-600' : 'text-green-600'}`}>
                      {billGroupsMsg}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'mcp' && (
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <Key className="h-6 w-6 mr-2 text-indigo-600" />
              MCP-konfiguration
            </h2>
            <ConfigRow label="MCP URL" value={MCP_URL} />
          </div>
        )}

      </div>
    </div>
  );
}
