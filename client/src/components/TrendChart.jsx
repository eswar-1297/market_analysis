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

export default function TrendChart({ title, hint, data, color = '#2541e0', height = 220 }) {
  return (
    <div className="chart-card">
      <div className="chart-title">
        <span>{title}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#eef1f6" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            stroke="#d7dcec"
            tick={{ fill: '#7983a0' }}
            fontSize={11}
            minTickGap={24}
          />
          <YAxis stroke="#d7dcec" tick={{ fill: '#7983a0' }} fontSize={11} width={48} />
          <Tooltip
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #d7dcec',
              borderRadius: 10,
              color: '#10162b',
              fontSize: 12,
              boxShadow: '0 10px 28px rgba(13,24,59,0.12)',
            }}
            labelStyle={{ color: '#7983a0' }}
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
