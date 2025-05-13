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

        # Prepare forecast summary for the last 7 days
        summary_df = forecast[["ds", "yhat"]].tail(7)
        summary_text = summary_df.to_string(index=False)

        # -----------------------------
        # 🤖 AI-POWERED INSIGHT (Together.ai)
        # -----------------------------

        # Define prompt for quick and actionable insights
        prompt = f"""
        You are a financial analyst specializing in commodity trading.

        Based on this 7-day price forecast for Paraxylene:

        {summary_text}

        Provide the following, in a concise and actionable format:
        1. What is the market trend (rising, falling, or neutral)?
        2. Should I take a long or short position in the next 7 days?
        3. What are the key risks to watch that could impact this forecast?
        4. How should I adjust my hedging strategy for the next 7 days?

        Please keep the response brief—traders need quick decisions.
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
            "max_tokens": 300
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
