import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

const shortDate = (d) => d?.slice(5); // MM-DD

export default function TrendChart({ title, hint, data, color = '#4f7cff', height = 220 }) {
  return (
    <div className="chart-card">
      <div className="chart-title">
        <span>{title}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#eef1f7" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            stroke="#a4adbf"
            tick={{ fill: '#7a869c' }}
            fontSize={11}
            minTickGap={24}
          />
          <YAxis stroke="#a4adbf" tick={{ fill: '#7a869c' }} fontSize={11} width={48} />
          <Tooltip
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #d5dce8',
              borderRadius: 10,
              color: '#1a2233',
              fontSize: 12,
              boxShadow: '0 6px 22px rgba(16,32,74,0.10)',
            }}
            labelStyle={{ color: '#7a869c' }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            name={title}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
