from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/signal', methods=['POST'])
def receive_signal():
    data = request.json
    print(f"Received signal: {data}")
    return jsonify({"status": "success", "message": "Signal received"}), 200

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=8080)
