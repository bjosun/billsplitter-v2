import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function Results() {
  const { expenseId } = useParams();
  const navigate = useNavigate();

  // TODO: Fetch expense details from API

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center">
            <button
              onClick={() => navigate('/history')}
              className="flex items-center text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-5 w-5 mr-2" />
              Back
            </button>
            <h1 className="ml-4 text-xl font-bold text-gray-900">Expense Details</h1>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-xl shadow-md p-6">
          <p>Loading expense {expenseId}...</p>
          <p className="text-gray-500 mt-4">This page will display detailed results for a saved expense calculation.</p>
        </div>
      </div>
    </div>
  );
}
