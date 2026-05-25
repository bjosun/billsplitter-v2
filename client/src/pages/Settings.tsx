import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Key, Settings as SettingsIcon } from 'lucide-react';
import { API_BASE_URL } from '../services/api';

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

export default function Settings() {
  const navigate = useNavigate();

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
              Back
            </button>
            <h1 className="ml-4 text-xl font-bold text-gray-900 flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-indigo-600" />
              Settings
            </h1>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <Key className="h-6 w-6 mr-2 text-indigo-600" />
            MCP OAuth Configuration
          </h2>
          <p className="text-gray-600 mb-4">
            Use these values in Claude Desktop/Claude Code MCP settings for OAuth.
          </p>
          <div className="space-y-3">
            <ConfigRow label="Authorization URL" value={AUTH_URL} />
            <ConfigRow label="Token URL" value={TOKEN_URL} />
            <ConfigRow label="MCP URL" value={MCP_URL} />
            <ConfigRow label="Client ID" value={CLIENT_ID || '(not configured)'} />
          </div>
          {!CLIENT_ID && (
            <p className="text-xs text-red-600 mt-4">
              VITE_OAUTH_CLIENT_ID is not set. Add it to client/.env and rebuild.
            </p>
          )}
          <p className="text-xs text-gray-500 mt-4">
            Client Secret can be empty for Google OAuth ID token flow.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-semibold mb-3">API Base</h2>
          <p className="text-gray-600 mb-3">
            Frontend calls backend API using this base URL (`VITE_API_BASE_URL` if set, else default).
          </p>
          <ConfigRow label="API Base URL" value={API_BASE_URL} />
        </div>
      </div>
    </div>
  );
}
