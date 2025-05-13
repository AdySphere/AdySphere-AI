# 📊 AI - Commodity Trading - Al, Cu Ver 0.4

**Version:** 0.4  
**Status:** MVP Demo (Working with Copper and Aluminum Test Cases)  
**Powered by:** Python, Facebook Prophet, Together.ai, Streamlit/Colab  

---

## 🚀 Overview

This MVP enables predictive analytics and AI-powered financial insights for **Aluminum** and **Copper** prices using real-world-like LME-format CSV data.

### 🧠 What it Does

- Reads time-series CSV files for Aluminum or Copper prices.
- Forecasts next 7 days using **Facebook Prophet**.
- Visualizes price trends.
- Sends the forecast + chart to **Together.ai** LLM to generate:
  - Market trend analysis
  - Suggested trading strategies
  - Investment insights and risks
  - Actionable summary

---

## 🛠️ Tech Stack

- 📍 Python
- 📈 Facebook Prophet
- 📊 Matplotlib, Pandas
- 🧠 Together.ai API (LLM)
- 🌐 Google Colab / Streamlit for frontend

---

## 📁 Files

| File | Description |
|------|-------------|
| `aluminum_sample.csv` | Sample CSV for Aluminum prices |
| `copper_sample.csv` | Sample CSV for Copper prices |
| `commodity_forecast_demo.ipynb` | Colab notebook for running full demo |
| `forecast_plot.png` | Saved plot of the 7-day forecast |
| `README.md` | This file |

---

## 📝 Sample Output

🧠 AI Market Insight:

 Based on the 7-day price forecast provided for aluminum, I will gladly share my analysis as a financial analyst and market expert:

1. Market trend: The market trend for aluminum is clearly rising in the next 7 days, with prices consistently increasing from December 21, 2023, to December 27, 2023.

2. Recommended trading strategy: Given the positive price forecast, my recommended trading strategy is to go long (buy) on aluminum. This strategy allows investors to profit from the anticipated price increase.

3. Investor approach for the next 7 days: Investors should consider the following approach:

   a. Enter a long position in aluminum at the current or near-forecast prices.
   b. Set a realistic target price based on the forecast, ideally near the highest predicted price (~2471.395162).
   c. Implement a stop-loss order to minimize potential losses if the market moves contrary to expectations. This can be placed below the lowest predicted price (~2431.416623) or at a level that ensures an acceptable risk-reward ratio.

4. Risks or opportunities to watch:

   Risks:
   - Any sudden negative news related to aluminum supply, demand, or geopolitical factors could cause a decline in prices.
   - Market sentiment changes could lead to a downturn in prices, impacting the overall trading strategy.

   Opportunities:
   - Positive news related to aluminum supply, demand, or geopolitical factors may drive prices higher, leading to greater profits.
   - If prices increase faster than anticipated, consider taking partial profits to lock in gains while maintaining a long position.

5. A final actionable, insightful summary: Based on the 7-day price forecast, aluminum prices are expected to rise, making it an attractive investment opportunity for the next week. Investors should consider entering a long position, setting a target price, and implementing a stop-loss order to manage risk. Monitor market news and sentiment for potential risks and opportunities to maximize profit or adjust the trading strategy as necessary.
