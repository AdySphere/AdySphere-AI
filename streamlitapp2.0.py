# 📦 INSTALL DEPENDENCIES
# Install dependencies with `pip install streamlit prophet matplotlib pandas requests`

import pandas as pd
from prophet import Prophet
import matplotlib.pyplot as plt
import requests
import json
import streamlit as st

# -----------------------------
# STREAMLIT UI: Upload File
# -----------------------------
st.title("Paraxylene Price Forecast & Market Insights")

st.write(
    """
    Upload a CSV file with the following columns: 
    'Date', 'Price (USD)' for Paraxylene prices.
    """
)

# Upload CSV
uploaded_file = st.file_uploader("Choose a CSV file", type=["csv"])

if uploaded_file is not None:
    # -----------------------------
    # 📊 LOAD AND PREP DATA
    # -----------------------------
    df = pd.read_csv(uploaded_file)

    # Ensure the correct columns exist
    if "Date" in df.columns and "Price (USD)" in df.columns:
        df = df[["Date", "Price (USD)"]].rename(columns={"Date": "ds", "Price (USD)": "y"})
        df["ds"] = pd.to_datetime(df["ds"])

        # -----------------------------
        # 🔮 FORECAST WITH PROPHET
        # -----------------------------
        model = Prophet()
        model.fit(df)

        future = model.make_future_dataframe(periods=7)
        forecast = model.predict(future)

        # -----------------------------
        # 📈 PLOT FORECAST
        # -----------------------------
        fig, ax = plt.subplots(figsize=(10, 6))
        model.plot(forecast, ax=ax)
        ax.set_title("Paraxylene Price Forecast (Next 7 Days)")
        ax.set_xlabel("Date")
        ax.set_ylabel("Price (USD)")
        plt.grid(True)
        st.pyplot(fig)

        # Prepare forecast summary
        summary_df = forecast[["ds", "yhat"]].tail(7)
        summary_text = summary_df.to_string(index=False)

        # -----------------------------
        # 🤖 AI-POWERED INSIGHT (Together.ai)
        # -----------------------------

        # Define prompt
        prompt = f"""
        You are a financial analyst and market expert.

        Given this 7-day price forecast for Paraxylene:

        {summary_text}

        Based on the forecast and the chart image (path: [forecast_plot]), answer the following questions:
        1. Market trend (rising, falling, or neutral): What does the forecast indicate about the market direction for Paraxylene in the next 7 days?
        2. Recommended trading strategy (long, short, hold): What would be the optimal trading strategy based on the predicted price movement?
        3. Risks or opportunities: What are the key risks and potential opportunities to watch in the market over the next week for Paraxylene?
        4. Hedging approach: How should I adjust my hedging strategy for Paraxylene in light of this price forecast?
        5. Impact of supply and demand: How do current supply and demand dynamics influence the price forecast? Are there any external factors to consider (e.g., geopolitical, economic, or weather-related)?
        6. Investment approach: Given the forecast, what investor approach is recommended for the next 7 days? Should investors hold, buy more, or sell?
        7. Volatility and market sentiment: What is the expected market volatility based on the predicted price movement? How is the sentiment towards Paraxylene in the market right now?

        Respond like a human expert providing actionable insights based on your analysis.
        """

        # -----------------------------
        # 🔑 TOGETHER.AI API CALL
        # -----------------------------
        api_key = "895b590f32d6475e94c42ecd8c42ab90b0b83c507bea5ef59b9748a5787f38c5"  # Replace with your Together.ai API key
        together_url = "https://api.together.xyz/v1/chat/completions"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": "mistralai/Mixtral-8x7B-Instruct-v0.1",  # You can change to LLaMA-3 if needed
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 600
        }

        response = requests.post(together_url, headers=headers, data=json.dumps(payload))

        # -----------------------------
        # 🧠 DISPLAY AI INSIGHT
        # -----------------------------
        if response.status_code == 200:
            insight = response.json()['choices'][0]['message']['content']
            st.subheader("🧠 AI Market Insight:")
            st.write(insight)
        else:
            st.error(f"Error from Together.ai: {response.status_code} - {response.text}")
    
    else:
        st.error("The uploaded file must contain 'Date' and 'Price (USD)' columns.")
