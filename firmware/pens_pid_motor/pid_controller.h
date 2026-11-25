#ifndef PID_CONTROLLER_H
#define PID_CONTROLLER_H

#include <Arduino.h>
#include <math.h>

// ============================================================================
// Discrete 2-DOF PID Controller dengan:
//   - Dukungan Bidirectional penuh (outMin = -255 .. outMax = +255)
//   - Feedforward + Deadzone Compensation (2-DOF Control Architecture)
//   - Kompensasi Tegangan Supply (Voltage-Scaled Effort)
//   - Anti-Windup (Conditional Integration Clamping pada total effort 2-DOF)
//   - Derivative-on-Measurement + EMA Low-Pass Filter (tanpa Derivative Kick)
//   - Bumpless Transfer dari Open-Loop ke Closed-Loop
// ============================================================================

class DiscretePID {
public:
  DiscretePID(float kp = 0.55f, float ki = 1.35f, float kd = 0.015f,
              float outMin = -255.0f, float outMax = 255.0f,
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
  // memperhitungkan kontribusi feedforward dan voltageScale saat transisi.
  void bumplessInit(float currentOutput, float currentMeasurement,
                    float feedforwardPwm = 0.0f, float voltageScale = 1.0f) {
    const float safeScale = (voltageScale > 0.1f) ? voltageScale : 1.0f;
    const float baseIntegral = (currentOutput / safeScale) - feedforwardPwm;
    _integral = constrain(baseIntegral, _outMin, _outMax);
    _prevMeasurement = currentMeasurement;
    _filteredDeriv = 0.0f;
    _lastOutput = constrain(currentOutput, _outMin, _outMax);
    _initialized = true;
  }

  float compute(float setpoint, float measurement, float dtSec,
                float feedforwardPwm = 0.0f, float voltageScale = 1.0f) {
    if (dtSec <= 0.0f) {
      return _lastOutput;
    }

    if (!_initialized) {
      _prevMeasurement = measurement;
      _filteredDeriv = 0.0f;
      _initialized = true;
    }

    // Jika setpoint ~0 dan motor sudah berhenti, matikan output secara bersih
    if (fabsf(setpoint) <= 0.5f && fabsf(measurement) < 1.5f) {
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

    // 3. Suku Integral dengan Anti-Windup 2-DOF (Conditional Clamping)
    float candidateIntegral = _integral;
    if (_ki > 0.0f) {
      candidateIntegral += (_ki * error * dtSec);
    } else {
      candidateIntegral = 0.0f;
    }

    const float rawOutput = (feedforwardPwm + pTerm + candidateIntegral + dTerm) * voltageScale;

    // Hanya perbarui akumulator integral jika total effort tidak saturasi searah error
    const bool saturatingHigh = (rawOutput > _outMax) && (error > 0.0f);
    const bool saturatingLow = (rawOutput < _outMin) && (error < 0.0f);

    if (!saturatingHigh && !saturatingLow) {
      _integral = constrain(candidateIntegral, _outMin, _outMax);
    }

    // 4. Total Output 2-DOF Terkompensasi Tegangan & Clamping PWM [-255..+255]
    const float output =
        constrain((feedforwardPwm + pTerm + _integral + dTerm) * voltageScale, _outMin, _outMax);
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
