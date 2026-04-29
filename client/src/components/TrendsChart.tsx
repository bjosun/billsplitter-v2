import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface TrendsData {
  month: string;
  totalBills: number;
  avgIncome: number;
  avgRemaining: number;
}

interface TrendsChartProps {
  data: TrendsData[];
}

export default function TrendsChart({ data }: TrendsChartProps) {
  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip formatter={(value: number) => `kr ${value.toFixed(2)}`} />
          <Legend />
          <Line 
            type="monotone" 
            dataKey="totalBills" 
            stroke="#6366f1" 
            strokeWidth={2}
            name="Total Bills"
          />
          <Line 
            type="monotone" 
            dataKey="avgIncome" 
            stroke="#10b981" 
            strokeWidth={2}
            name="Average Income"
          />
          <Line 
            type="monotone" 
            dataKey="avgRemaining" 
            stroke="#f59e0b" 
            strokeWidth={2}
            name="Average Remaining"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
