import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Key, Settings as SettingsIcon, User, Users, Phone, Mail, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import {
  API_BASE_URL,
  getMyProfile,
  updateMyProfile,
  getHouseholds,
  getHouseholdMembers,
  type UserProfile,
  type HouseholdMember,
} from '../services/api';
import type { Household } from '../types';

const AUTH_URL = `${API_BASE_URL}/auth/authorize`;
const TOKEN_URL = `${API_BASE_URL}/auth/token`;
const MCP_URL = `${API_BASE_URL}/mcp`;
const CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID || '';

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

function MemberRow({ member, isMe }: { member: HouseholdMember; isMe: boolean }) {
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
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const [households, setHouseholds] = useState<Household[]>([]);
  const [membersByHousehold, setMembersByHousehold] = useState<Record<string, HouseholdMember[]>>({});
  const [expandedHousehold, setExpandedHousehold] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getMyProfile()
      .then(p => {
        setProfile(p);
        setEditName(p.name);
        setEditPhone(p.phone || '');
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
      .then(members => setMembersByHousehold(prev => ({ ...prev, [expandedHousehold]: members })))
      .catch(console.error)
      .finally(() => setMembersLoading(prev => ({ ...prev, [expandedHousehold!]: false })));
  }, [expandedHousehold, membersByHousehold]);

  const handleSaveProfile = async () => {
    setSaving(true);
    setSaveMessage('');
    try {
      const updated = await updateMyProfile({ name: editName, phone: editPhone });
      setProfile(updated);
      setSaveMessage('Profil sparad!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch {
      setSaveMessage('Kunde inte spara. Försök igen.');
    } finally {
      setSaving(false);
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
                  type="text"
                  value={profile?.email || ''}
                  readOnly
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-400 mt-1">E-postadressen används för att matcha e-postutskick och kan inte ändras här.</p>
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

        {/* MCP section */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <Key className="h-6 w-6 mr-2 text-indigo-600" />
            MCP OAuth-konfiguration
          </h2>
          <p className="text-gray-600 mb-4 text-sm">
            Använd dessa värden i Claude Desktop/Claude Code MCP-inställningar för OAuth.
          </p>
          <div className="space-y-3">
            <ConfigRow label="Authorization URL" value={AUTH_URL} />
            <ConfigRow label="Token URL" value={TOKEN_URL} />
            <ConfigRow label="MCP URL" value={MCP_URL} />
            <ConfigRow label="Client ID" value={CLIENT_ID || '(not configured)'} />
          </div>
          <ConfigRow label="API Base URL" value={API_BASE_URL} />
        </div>

      </div>
    </div>
  );
}
