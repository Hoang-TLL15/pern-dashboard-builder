// src/charts/registerChartjs.js
// Chart.js v4 yêu cầu đăng ký thủ công từng thành phần dùng đến — import file
// này (side-effect only) trước khi render bất kỳ chart nào.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  BarController,
  LineController,
  PieController,
  DoughnutController,
  RadarController,
  ScatterController,
  BubbleController,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';

ChartJS.register(
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  BarController,
  LineController,
  PieController,
  DoughnutController,
  RadarController,
  ScatterController,
  BubbleController,
  Filler,
  Tooltip,
  Legend,
  ChartDataLabels
);
