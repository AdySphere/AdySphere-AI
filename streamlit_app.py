import streamlit as st
import pandas as pd
import matplotlib.pyplot as plt
from prophet import Prophet
import requests
import json
import os

# -----------------------------
# 🔧 Config
# -----------------------------
st.set_page_config(page_title="AI Commodity Trading (Al, Cu)", layout="centered")
TOGETHER_API_KEY = "895b590f32d6475e94c42ecd8c42ab90b0b83c507bea5ef59b9748a5787f38c5"
TOGETHER_API_URL = "https://api.together.xyz/v1/chat/completions"
TOGETHER_MODEL = "mistralai/Mixtral-8x7B-Instruct-v0.1"

# -----------------------------
# 🚀 App UI
# -----------------------------
st.title("📈 AI Commodity Trading - Aluminum & Copper (Ver 0.4)")
st.markdown("Upload historical LME pricing data for **Aluminum** or **Copper** in CSV format.")

uploaded_file = st.file_uploader("Upload your CSV file", type=["csv"])

# -----------------------------
# 🧠 AI Insight Function
# -----------------------------
def get_ai_insight(prompt):
    headers = {
        "Authorization": f"Bearer {TOGETHER_API_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "model": TOGETHER_MODEL,
        "max_tokens": 500,
        "temperature": 0.7,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }

    response = requests.post(TOGETHER_API_URL, headers=headers, data=json.dumps(data))

    if response.status_code == 200:
        return response.json()["choices"][0]["message"]["content"]
    else:
        return f"(AI Error: {response.status_code} - {response.text})"

# -----------------------------
# 🔍 Forecast Function
# -----------------------------
def forecast_and_plot(df, metal_name):
    df = df[["Date", "Price"]].rename(columns={"Date": "ds", "Price": "y"})
    df["ds"] = pd.to_datetime(df["ds"])

    model = Prophet()
    model.fit(df)

    future = model.make_future_dataframe(periods=7)
    forecast = model.predict(future)

    fig = model.plot(forecast)
    plt.title(f"{metal_name} Price Forecast (Next 7 Days)")
    plt.xlabel("Date")
    plt.ylabel("Price (USD)")
    plt.grid(True)

    st.pyplot(fig)

    forecast_tail = forecast[["ds", "yhat"]].tail(7)
    st.subheader("📅 7-Day Forecasted Prices")
    st.dataframe(forecast_tail)

    # Prompt AI to analyze forecast
    ai_prompt = f"""
You are a financial market expert analyzing the price forecast for {metal_name} over the next 7 days. Below is the forecasted price movement:

{forecast_tail.to_string(index=False)}

Please provide a detailed analysis including:
1. Market trend based on the forecasted values (rising, falling, or neutral).
2. Possible trading strategies (long, short, or neutral) based on the trend.
3. How would an investor approach the market in the next 7 days?
4. What risks or opportunities should traders be aware of in the upcoming week?
5. Provide a detailed, actionable summary for investors with financial insights based on the forecast.

Make sure the analysis is based on the forecasted values and the plot shown.
    """
    with st.spinner("🔍 Generating AI insight..."):
        ai_insight = get_ai_insight(ai_prompt)

    st.subheader("🧠 AI Market Insight")
    st.markdown(ai_insight)

# -----------------------------
# ✅ Run App Logic
# -----------------------------
if uploaded_file:
    df = pd.read_csv(uploaded_file)

    if "Date" not in df.columns or "Price" not in df.columns:
        st.error("CSV must contain 'Date' and 'Price' columns.")
    else:
        metal = st.selectbox("Select the metal", ["Aluminum", "Copper"])
        forecast_and_plot(df, metal)
