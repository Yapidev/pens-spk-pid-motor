#ifndef PID_CONTROLLER_H
#define PID_CONTROLLER_H

#include <Arduino.h>

// ============================================================================
// Discrete PID Controller dengan:
//   - Anti-Windup (Conditional Integration / Clamping)
//   - Derivative-on-Measurement (menghindari Derivative Kick saat perubahan SP)
//   - Low-Pass Filter pada suku Derivatif
//   - Output Clamping (0 - 255 PWM)
//   - Bumpless Transfer dari Open-Loop ke Closed-Loop
// ============================================================================

class DiscretePID {
public:
  DiscretePID(float kp = 1.0f, float ki = 0.0f, float kd = 0.0f,
              float outMin = 0.0f, float outMax = 255.0f,
              float derivAlpha = 0.25f)
      : _kp(kp),
        _ki(ki),
        _kd(kd),
        _outMin(outMin),
        _outMax(outMax),
        _derivAlpha(constrain(derivAlpha, 0.05f, 1.0f)),
        _integral(0.0f),
        _prevMeasurement(0.0f),
        _filteredDeriv(0.0f),
        _lastError(0.0f),
        _lastOutput(0.0f),
        _initialized(false) {}

  void setTunings(float kp, float ki, float kd) {
    _kp = (kp < 0.0f) ? 0.0f : kp;
    _ki = (ki < 0.0f) ? 0.0f : ki;
    _kd = (kd < 0.0f) ? 0.0f : kd;
    if (_ki == 0.0f) {
      _integral = 0.0f;
    }
  }

  void setKp(float kp) { _kp = (kp < 0.0f) ? 0.0f : kp; }
  void setKi(float ki) {
    _ki = (ki < 0.0f) ? 0.0f : ki;
    if (_ki == 0.0f) {
      _integral = 0.0f;
    }
  }
  void setKd(float kd) { _kd = (kd < 0.0f) ? 0.0f : kd; }

  float getKp() const { return _kp; }
  float getKi() const { return _ki; }
  float getKd() const { return _kd; }
  float getLastError() const { return _lastError; }
  float getIntegral() const { return _integral; }
  float getLastOutput() const { return _lastOutput; }

  void reset(float currentMeasurement = 0.0f) {
    _integral = 0.0f;
    _prevMeasurement = currentMeasurement;
    _filteredDeriv = 0.0f;
    _lastError = 0.0f;
    _lastOutput = 0.0f;
    _initialized = false;
  }

  // Bumpless transfer saat beralih dari Open-Loop ke Closed-Loop PID
  void bumplessInit(float currentOutput, float currentMeasurement) {
    _integral = constrain(currentOutput, _outMin, _outMax);
    _prevMeasurement = currentMeasurement;
    _filteredDeriv = 0.0f;
    _lastOutput = _integral;
    _initialized = true;
  }

  float compute(float setpoint, float measurement, float dtSec) {
    if (dtSec <= 0.0f) {
      return _lastOutput;
    }

    if (!_initialized) {
      _prevMeasurement = measurement;
      _filteredDeriv = 0.0f;
      _initialized = true;
    }

    // Jika setpoint 0 dan kecepatan sangat rendah, pastikan output mati bersih
    if (setpoint <= 0.01f && measurement < 1.0f) {
      _integral = 0.0f;
      _filteredDeriv = 0.0f;
      _lastError = setpoint - measurement;
      _lastOutput = 0.0f;
      _prevMeasurement = measurement;
      return 0.0f;
    }

    const float error = setpoint - measurement;
    _lastError = error;

    // 1. Suku Proporsional
    const float pTerm = _kp * error;

    // 2. Suku Derivatif (Derivative-on-Measurement + EMA Low-Pass Filter)
    const float rawDeriv = -(measurement - _prevMeasurement) / dtSec;
    _filteredDeriv = (_derivAlpha * rawDeriv) + ((1.0f - _derivAlpha) * _filteredDeriv);
    const float dTerm = _kd * _filteredDeriv;
    _prevMeasurement = measurement;

    // 3. Suku Integral dengan Anti-Windup (Conditional Clamping)
    float candidateIntegral = _integral;
    if (_ki > 0.0f) {
      candidateIntegral += (_ki * error * dtSec);
    } else {
      candidateIntegral = 0.0f;
    }

    const float rawOutput = pTerm + candidateIntegral + dTerm;

    // Hanya perbarui akumulator integral jika tidak saturasi searah error
    const bool saturatingHigh = (rawOutput > _outMax) && (error > 0.0f);
    const bool saturatingLow = (rawOutput < _outMin) && (error < 0.0f);

    if (!saturatingHigh && !saturatingLow) {
      _integral = constrain(candidateIntegral, _outMin, _outMax);
    }

    // 4. Total Output & Clamping PWM [0..255]
    const float output = constrain(pTerm + _integral + dTerm, _outMin, _outMax);
    _lastOutput = output;
    return output;
  }

private:
  float _kp;
  float _ki;
  float _kd;
  float _outMin;
  float _outMax;
  float _derivAlpha;

  float _integral;
  float _prevMeasurement;
  float _filteredDeriv;
  float _lastError;
  float _lastOutput;
  bool _initialized;
};

#endif // PID_CONTROLLER_H
