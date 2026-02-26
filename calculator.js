/**
 * Diabetes Risk Calculator – EID Enhanced
 * Based on the diabetes prediction model (Schmidt et al. 2005, ARIC Study)
 *
 * Architecture:
 *  - CONFIG          : All constants, coefficients, ranges, labels, treatments
 *  - RiskModel       : Pure business logic (no DOM access)
 *  - UIController    : All DOM reads/writes (no business logic)
 *  - RadarChart      : SVG configural display (EID RBB)
 *  - TimelineChart   : Snapshot trend display (EID temporal)
 *  - App             : Bootstraps the app and wires up event listeners
 *
 * EID Principles addressed:
 *  - WDA: Slider tracks encode CONFIG.THRESHOLDS as color zones
 *  - SBB: Preattentive risk-glow on hero section
 *  - RBB: Radar polygon – symmetric = healthy, distorted = at risk
 *  - KBB: What-If badges (delta %) + Beta-vector arrows on labels
 */

'use strict';

// ============================================
// 1. CONFIGURATION & CONSTANTS
// ============================================

const CONFIG = Object.freeze({

    /** Logistic-regression betas (Schmidt et al. 2005) */
    BETAS: {
        age:        0.0173,
        race:       0.4433,
        parentHist: 0.4981,
        sbp:        0.0111,
        waist:      0.0273,   // cm
        height:    -0.0326,   // cm
        fastGlu:    1.5849,   // mmol/L
        cholHDL:   -0.4718,   // mmol/L
        cholTri:    0.242,    // mmol/L
        sigma:     -9.9808    // Intercept
    },

    /** Population means from the ARIC Study baseline cohort */
    MEANS: {
        age:        54,
        race:        0.25,
        parentHist:  0.3,
        sbp:       120,
        waist:      97,    // cm
        height:    168,    // cm
        fastGlu:     5.5,  // mmol/L
        cholHDL:     1.3,  // mmol/L
        cholTri:     1.7   // mmol/L
    },

    /** Conversion factors US ↔ SI */
    CONVERSIONS: {
        heightToCm:  2.54,
        waistToCm:   2.54,
        gluToMmol:   1 / 18,
        hdlToMmol:   1 / 38.67,
        triToMmol:   1 / 88.57
    },

    /** Slider min / max / step per field and unit system */
    RANGES: {
        age:      { us: [20, 80, 1],       si: [20, 80, 1] },
        sbp:      { us: [80, 220, 1],      si: [80, 220, 1] },
        height:   { us: [48, 84, 1],       si: [122, 213, 1] },
        waist:    { us: [25, 60, 1],       si: [64, 152, 1] },
        fastGlu:  { us: [50, 300, 1],      si: [2.8, 16.7, 0.1] },
        cholHDL:  { us: [20, 100, 1],      si: [0.5, 2.6, 0.1] },
        cholTri:  { us: [50, 500, 1],      si: [0.6, 5.6, 0.1] }
    },

    /** Human-readable labels for the contribution chart */
    LABELS: {
        age:        'Age',
        race:       'Race',
        parentHist: 'Parental History',
        sbp:        'Blood Pressure',
        waist:      'Waist Size',
        height:     'Height',
        fastGlu:    'Glucose',
        cholHDL:    'HDL Cholesterol',
        cholTri:    'Triglycerides'
    },

    /** Short labels for radar chart axes */
    RADAR_LABELS: {
        fastGlu: 'Glucose',
        sbp:     'BP',
        cholTri: 'Triglyc.',
        waist:   'Waist',
        cholHDL: 'HDL',
        age:     'Age'
    },

    /**
     * Clinical decision thresholds (all in SI units).
     * Sources: ADA 2024, ESC 2023, WHO
     */
    THRESHOLDS: {
        fastGlu: { elevated: 5.6,  high: 7.0  },
        sbp:     { elevated: 130,  high: 160  },
        cholHDL: { low: 1.0,       veryLow: 0.8 },
        cholTri: { elevated: 1.7,  high: 2.3  },
        waist:   { elevated: 94,   high: 102  }
    },

    /** Patient-friendly treatment recommendations per risk factor (ESC 2023) */
    TREATMENTS: {
        fastGlu: {
            id:    'glucose-treatment',
            icon:  'bloodtype',
            title: 'Blood Sugar Management',
            therapies: [
                { name: 'Standard Medication', desc: 'Metformin is often the first step to help control blood sugar levels.' },
                { name: 'Heart & Kidney Protection', desc: 'If you have heart or kidney concerns, ask your doctor about newer medications that specifically protect these organs (SGLT2 inhibitors or GLP-1) while also supporting weight loss.' }
            ]
        },
        sbp: {
            id:    'bp-treatment',
            icon:  'favorite',
            title: 'Blood Pressure Control',
            therapies: [
                { name: 'Combination Medications', desc: 'It is recommend to start with a combination of different blood pressure medications (e.g. RAS inhibitors and CCBs).' },
                { name: 'Heart-Healthy Diet', desc: 'Restriction of alcohol and sodium consumption, increased consumption of vegetables, use of low-fat dairy products can lower blood pressure naturally.' }
            ]
        },
        cholHDL: {
            id:    'hdl-treatment',
            icon:  'water_drop',
            title: 'Good Cholesterol (HDL) Improvement',
            therapies: [
                { name: 'Regular Exercise', desc: 'Aim for 150 minutes per week of activity like brisk walking, or 75 minutes of intense exercise.' },
                { name: 'Healthy Lifestyle', desc: 'Stopping smoking, limiting alcohol, and eating healthy fats (olive oil, nuts, fish) all help.' }
            ]
        },
        cholTri: {
            id:    'tri-treatment',
            icon:  'science',
            title: 'Blood Fats (Triglycerides)',
            therapies: [
                { name: 'Prescription Fish Oil', desc: 'If blood fats (triglycerides) remain high, special prescription fish oil (icosapent ethyl) might be considered.' },
                { name: 'Cholesterol Medication', desc: 'Cholesterol-lowering medication (Statins) is usually recommended to protect your blood vessels.' }
            ]
        },
        waist: {
            id:    'waist-treatment',
            icon:  'straighten',
            title: 'Weight Management',
            therapies: [
                { name: 'Diet & Exercise', desc: 'Reducing daily calories and exercising more leads to steady weight loss.' },
                { name: 'Medications', desc: 'Glucose-lowering drugs with additional weight-reducing effects (e.g. GLP-1RA) can also help.' }
            ],
            surgicalOption: { name: 'Surgical Options', desc: 'For significant obesity with health problems, weight-loss surgery may be discussed.' }
        }
    },

    /** Default values for the reset function */
    DEFAULTS: {
        age:        50,
        sbp:       120,
        height:    { us: 66,  si: 168 },
        waist:     { us: 36,  si: 91 },
        fastGlu:   { us: 95,  si: 5.3 },
        cholHDL:   { us: 50,  si: 1.3 },
        cholTri:   { us: 150, si: 1.7 },
        race:       false,
        parentHist: false
    }
});


// ============================================
// 2. RISK MODEL  (pure business logic, zero DOM)
// ============================================

const RiskModel = (() => {

    const toSI = (inputs, isMetric) => {
        if (isMetric) return { ...inputs };
        const c = CONFIG.CONVERSIONS;
        return {
            ...inputs,
            height:  inputs.height  * c.heightToCm,
            waist:   inputs.waist   * c.waistToCm,
            fastGlu: inputs.fastGlu * c.gluToMmol,
            cholHDL: inputs.cholHDL * c.hdlToMmol,
            cholTri: inputs.cholTri * c.triToMmol
        };
    };

    const computeProbability = (siVals) => {
        const B = CONFIG.BETAS;
        const score =
            B.sigma +
            B.age       * siVals.age       +
            B.race      * siVals.race      +
            B.parentHist * siVals.parentHist +
            B.sbp       * siVals.sbp       +
            B.waist     * siVals.waist     +
            B.height    * siVals.height    +
            B.fastGlu   * siVals.fastGlu   +
            B.cholHDL   * siVals.cholHDL   +
            B.cholTri   * siVals.cholTri;
        return 1 / (1 + Math.exp(-score));
    };

    const computeContributions = (siVals) => {
        const B = CONFIG.BETAS;
        const M = CONFIG.MEANS;
        return {
            age:        B.age       * (siVals.age       - M.age),
            race:       B.race      * (siVals.race      - M.race),
            parentHist: B.parentHist * (siVals.parentHist - M.parentHist),
            sbp:        B.sbp       * (siVals.sbp       - M.sbp),
            waist:      B.waist     * (siVals.waist     - M.waist),
            height:     B.height    * (siVals.height    - M.height),
            fastGlu:    B.fastGlu   * (siVals.fastGlu   - M.fastGlu),
            cholHDL:    B.cholHDL   * (siVals.cholHDL   - M.cholHDL),
            cholTri:    B.cholTri   * (siVals.cholTri   - M.cholTri)
        };
    };

    const getElevatedFactors = (siVals, rawInputs, isMetric) => {
        const T = CONFIG.THRESHOLDS;
        const elevatedFactors = [];

        if (siVals.fastGlu >= T.fastGlu.elevated) elevatedFactors.push('fastGlu');
        if (siVals.sbp     >= T.sbp.elevated)     elevatedFactors.push('sbp');
        if (siVals.cholHDL <= T.cholHDL.low)       elevatedFactors.push('cholHDL');

        const triElevated = isMetric
            ? siVals.cholTri >= T.cholTri.elevated
            : rawInputs.cholTri >= 150;
        if (triElevated) elevatedFactors.push('cholTri');

        if (siVals.waist >= T.waist.elevated) elevatedFactors.push('waist');

        return { elevatedFactors, waistIsHigh: siVals.waist >= T.waist.high };
    };

    /**
     * EID KBB: Compute What-If delta for a single field.
     */
    const computeWhatIfDelta = (rawInputs, isMetric, field, direction) => {
        const baseProb = computeProbability(toSI(rawInputs, isMetric));
        const mode = isMetric ? 'si' : 'us';
        const step = CONFIG.RANGES[field]?.[mode]?.[2] ?? 1;
        const alteredInputs = { ...rawInputs };
        alteredInputs[field] = rawInputs[field] + (direction * step * 5);
        const altProb = computeProbability(toSI(alteredInputs, isMetric));
        return (altProb - baseProb) * 100;
    };

    return { toSI, computeProbability, computeContributions, getElevatedFactors, computeWhatIfDelta };
})();


// ============================================
// 3. UI CONTROLLER  (all DOM interaction)
// ============================================

const UIController = (() => {

    const el = (id) => document.getElementById(id);
    const setText = (id, text) => { const n = el(id); if (n) n.textContent = text; };

    // --- Slider fills ---
    const updateSliderFill = (field) => {
        const slider = el(`${field}-slider`);
        const fill   = el(`${field}-fill`);
        if (!slider || !fill) return;
        const { min, max, value } = slider;
        const pct = ((parseFloat(value) - parseFloat(min)) / (parseFloat(max) - parseFloat(min))) * 100;
        fill.style.width = `${pct}%`;
    };

    const updateAllSliderFills = () => {
        ['age', 'sbp', 'height', 'waist', 'fastGlu', 'cholHDL', 'cholTri'].forEach(updateSliderFill);
    };

    // --- Slider ranges ---
    const applyRangeToField = (field, mode) => {
        const range  = CONFIG.RANGES[field]?.[mode];
        const slider = el(`${field}-slider`);
        const input  = el(`${field}-value`);
        if (!range || !slider || !input) return;
        const [min, max, step] = range;
        [slider, input].forEach(node => { node.min = min; node.max = max; node.step = step; });
    };

    const updateSliderRanges = (mode) => {
        Object.keys(CONFIG.RANGES).forEach(field => applyRangeToField(field, mode));
    };

    // --- Unit labels ---
    const updateUnitLabels = (isMetric) => {
        const units = isMetric
            ? { h: 'cm', w: 'cm', g: 'mmol/L', c: 'mmol/L' }
            : { h: 'in', w: 'in', g: 'mg/dL',  c: 'mg/dL'  };

        const wrap = (s) => s.includes('mmol') ? s : `(${s})`;
        setText('height-unit',   wrap(units.h));
        setText('waist-unit',    wrap(units.w));
        setText('fastGlu-unit',  wrap(units.g));
        setText('cholHDL-unit',  wrap(units.c));
        setText('cholTri-unit',  wrap(units.c));

        setText('height-value-unit',  units.h);
        setText('waist-value-unit',   units.w);
        setText('fastGlu-value-unit', units.g);
        setText('cholHDL-value-unit', units.c);
        setText('cholTri-value-unit', units.c);

        updateSliderAxisLabels(isMetric);

        const usLabel = el('unit-label-us');
        const siLabel = el('unit-label-si');
        if (usLabel) { usLabel.style.fontWeight = isMetric ? '400' : '600'; usLabel.style.color = isMetric ? '' : 'var(--text-primary)'; }
        if (siLabel) { siLabel.style.fontWeight = isMetric ? '600' : '400'; siLabel.style.color = isMetric ? 'var(--text-primary)' : ''; }
    };

    const updateSliderAxisLabels = (isMetric) => {
        const mode = isMetric ? 'si' : 'us';
        const fmt  = (v, isFloat) => isFloat ? parseFloat(v).toFixed(1) : v;

        const setAxisLabels = (field) => {
            const [min, max] = CONFIG.RANGES[field][mode];
            const mid = (min + max) / 2;
            const si  = isMetric && CONFIG.RANGES[field].si[2] < 1;
            setText(`${field}-min`, fmt(min, si));
            setText(`${field}-mid`, fmt(mid, si));
            setText(`${field}-max`, fmt(max, si));
        };

        setAxisLabels('height');
        setAxisLabels('waist');
        setAxisLabels('cholTri');
    };

    // --- Value conversion ---
    const applyConvertedValues = (savedValues, isMetric) => {
        const c    = CONFIG.CONVERSIONS;
        const mode = isMetric ? 'si' : 'us';

        Object.entries(savedValues).forEach(([field, rawVal]) => {
            let val = rawVal;
            if (isMetric) {
                if (field === 'height' || field === 'waist') val *= c.heightToCm;
                if (field === 'fastGlu') val *= c.gluToMmol;
                if (field === 'cholHDL') val *= c.hdlToMmol;
                if (field === 'cholTri') val *= c.triToMmol;
            } else {
                if (field === 'height' || field === 'waist') val /= c.heightToCm;
                if (field === 'fastGlu') val /= c.gluToMmol;
                if (field === 'cholHDL') val /= c.hdlToMmol;
                if (field === 'cholTri') val /= c.triToMmol;
            }
            const [min, max, step] = CONFIG.RANGES[field][mode];
            val = Math.min(Math.max(val, min), max);
            val = step < 1 ? parseFloat(val.toFixed(1)) : Math.round(val);

            const input  = el(`${field}-value`);
            const slider = el(`${field}-slider`);
            if (input)  input.value  = val;
            if (slider) slider.value = val;
        });
    };

    // --- Reading inputs ---
    const readInputs = () => ({
        age:        parseFloat(el('age-value').value)      || 0,
        race:       el('race-toggle').checked  ? 1 : 0,
        parentHist: el('parentHist-toggle').checked ? 1 : 0,
        sbp:        parseFloat(el('sbp-value').value)      || 0,
        height:     parseFloat(el('height-value').value)   || 0,
        waist:      parseFloat(el('waist-value').value)    || 0,
        fastGlu:    parseFloat(el('fastGlu-value').value)  || 0,
        cholHDL:    parseFloat(el('cholHDL-value').value)  || 0,
        cholTri:    parseFloat(el('cholTri-value').value)  || 0
    });

    // --- Rendering results ---

    /** Display the computed risk percentage + preattentive glow (EID SBB). */
    const renderRisk = (pct) => {
        setText('risk-percentage', pct.toFixed(1));

        // Color the percentage text dynamically
        const riskEl = el('risk-percentage');
        const pctEl  = document.querySelector('.risk-unit');
        let color, level;
        if      (pct >= 50) { color = '#ff3b30'; level = 'danger'; }
        else if (pct >= 25) { color = '#ff6723'; level = 'warning'; }
        else if (pct >= 10) { color = '#ff9f0a'; level = 'alert'; }
        else                { color = '#34c759'; level = 'safe'; }

        if (riskEl) riskEl.style.color = color;
        if (pctEl)  pctEl.style.color  = color;

        // EID SBB: Set data attribute on hero section for background glow
        const heroSection = el('risk-score-card');
        if (heroSection) {
            heroSection.setAttribute('data-risk-level', level);
        }

        // Dynamic risk-level borders on Input & Treatment panels
        const panelInput     = el('panel-input');
        const panelTreatment = el('panel-treatment');
        if (panelInput)     panelInput.setAttribute('data-risk-level', level);
        if (panelTreatment) panelTreatment.setAttribute('data-risk-level', level);

        // Update risk bar marker position (0-100% scale, capped at 80% for display)
        const marker = el('risk-bar-marker');
        if (marker) {
            const pos = Math.min(pct, 100) / 100 * 100;
            marker.style.left = `${pos}%`;
            marker.style.borderColor = color;
        }
    };

    /**
     * Änderung 6 (aktualisiert): Render the tornado (diverging bar) chart –
     * Apple-styled version with PERCENTAGE contributions and natural language labels.
     *
     * Mathematical basis (Van Belle & Calster, 2015):
     *   percentage_i = |contribution_i| / Σ|contribution_j| × 100
     * where contribution_i = β_i × (x_i − mean_i)
     *
     * This normalization ensures all contributions sum to 100%, making them
     * interpretable as relative importance shares for laypeople.
     */
    const renderContributionChart = (contributions) => {
        const container = el('contribution-chart');
        if (!container) return;
        container.innerHTML = '';

        // Compute absolute sum for percentage normalization
        const totalAbsContribution = Object.values(contributions)
            .reduce((sum, val) => sum + Math.abs(val), 0);

        const items = Object.entries(contributions)
            .map(([key, val]) => ({
                key,
                val,
                abs: Math.abs(val),
                pctOfTotal: totalAbsContribution > 0
                    ? (Math.abs(val) / totalAbsContribution) * 100
                    : 0
            }))
            .sort((a, b) => b.abs - a.abs);

        const maxPct = Math.max(...items.map(i => i.pctOfTotal), 1);

        items.forEach(({ key, val, abs, pctOfTotal }, idx) => {
            const barWidth = (pctOfTotal / maxPct) * 100;
            const isPositive = val >= 0;

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:6px 4px;border-bottom:1px solid rgba(0,0,0,0.04);flex-wrap:wrap;border-radius:6px;';
            row.setAttribute('data-field', key);

            // Label
            const label = document.createElement('div');
            label.style.cssText = 'width:80px;flex-shrink:0;font-size:11px;font-weight:500;color:#6e6e73;text-align:right;';
            label.textContent = CONFIG.LABELS[key];

            // Chart area
            const chartArea = document.createElement('div');
            chartArea.style.cssText = 'flex:1;display:flex;height:22px;position:relative;align-items:center;';

            const leftPane = document.createElement('div');
            leftPane.style.cssText = 'flex:1;display:flex;justify-content:flex-end;padding-right:1px;height:100%;align-items:center;';

            const centerLine = document.createElement('div');
            centerLine.style.cssText = 'width:2px;height:100%;background:#d1d1d6;border-radius:1px;flex-shrink:0;';

            const rightPane = document.createElement('div');
            rightPane.style.cssText = 'flex:1;display:flex;justify-content:flex-start;padding-left:1px;height:100%;align-items:center;';

            const bar = document.createElement('div');
            bar.style.cssText = `height:16px;width:${barWidth}%;border-radius:4px;transition:width 0.4s cubic-bezier(0.25,0.46,0.45,0.94);min-width:3px;`;

            if (!isPositive) {
                bar.style.background = 'linear-gradient(270deg, #34c759, #30d158)';
                leftPane.appendChild(bar);
            } else {
                bar.style.background = 'linear-gradient(90deg, #ff3b30, #ff453a)';
                rightPane.appendChild(bar);
            }

            chartArea.append(leftPane, centerLine, rightPane);

            // Value – now as percentage
            const valueEl = document.createElement('div');
            valueEl.style.cssText = 'width:50px;flex-shrink:0;font-size:10px;font-weight:600;';
            const pctDisplay = pctOfTotal < 1 && pctOfTotal > 0
                ? '<1%'
                : Math.round(pctOfTotal) + '%';

            if (!isPositive) {
                valueEl.style.color = '#34c759';
                valueEl.style.textAlign = 'right';
                valueEl.textContent = pctDisplay;
            } else {
                valueEl.style.color = '#ff3b30';
                valueEl.style.textAlign = 'left';
                valueEl.textContent = pctDisplay;
            }

            const mainLine = document.createElement('div');
            mainLine.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;';
            mainLine.append(label, chartArea, valueEl);
            row.appendChild(mainLine);

            // Natural language explanation for top 3
            if (idx < 3) {
                const explainEl = document.createElement('div');
                explainEl.style.cssText = 'width:calc(100% - 88px);margin-left:88px;font-size:9px;color:#86868b;font-style:italic;margin-top:2px;line-height:1.3;';

                if (isPositive) {
                    explainEl.textContent = `Your ${CONFIG.LABELS[key].toLowerCase()} contributes ${Math.round(pctOfTotal)}% to your risk – it is above average.`;
                } else {
                    explainEl.textContent = `Your ${CONFIG.LABELS[key].toLowerCase()} reduces your risk by ${Math.round(pctOfTotal)}% – it is below average/protective.`;
                }

                row.appendChild(explainEl);
            }

            container.appendChild(row);
        });

        // Legend
        const legend = document.createElement('div');
        legend.style.cssText = 'display:flex;justify-content:center;gap:16px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,0,0,0.06);';
        legend.innerHTML = `
            <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#6e6e73;">
                <div style="width:10px;height:6px;border-radius:2px;background:linear-gradient(90deg,#30d158,#34c759);"></div>
                Reduces Risk
            </div>
            <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#6e6e73;">
                <div style="width:10px;height:6px;border-radius:2px;background:linear-gradient(90deg,#ff3b30,#ff453a);"></div>
                Increases Risk
            </div>
            <div style="display:flex;align-items:center;gap:4px;font-size:9px;color:#86868b;">
                (% of total contribution)
            </div>
        `;
        container.appendChild(legend);
    };


    /** Move the heatmap pointer. */
    const renderHeatmapPointer = (contributions) => {
        const pointer = el('heatmap-pointer');
        if (!pointer) return;

        const gluContrib = contributions.fastGlu;
        const otherContrib = Object.entries(contributions)
            .filter(([key]) => key !== 'fastGlu')
            .reduce((sum, [, val]) => sum + val, 0);

        const xPct = 5 + (Math.min(Math.max(gluContrib, -4), 4) + 4) / 8 * 90;
        const yPct = 5 + (Math.min(Math.max(otherContrib, -3), 3) + 3) / 6 * 90;

        pointer.style.left   = `${xPct}%`;
        pointer.style.bottom = `${yPct}%`;
    };

    /** Render factor-specific treatment cards. */
    const renderTreatmentRecommendations = ({ elevatedFactors, waistIsHigh }, contributions = {}) => {
        const container = el('dynamic-treatments');
        if (!container) return;
        container.innerHTML = '';

        if (elevatedFactors.length === 0) {
            container.innerHTML = `
                <div class="treatment-ok">
                    <span class="material-icons-round">check_circle</span>
                    <p>All modifiable risk factors are within normal range. Continue maintaining a healthy lifestyle.</p>
                </div>
            `;
            return;
        }

        const sortedFactors = [...elevatedFactors].sort((a, b) =>
            (contributions[b] ?? 0) - (contributions[a] ?? 0)
        );

        sortedFactors.forEach(factor => {
            const treatment = CONFIG.TREATMENTS[factor];
            if (!treatment) return;

            let therapies = [...treatment.therapies];
            if (factor === 'waist' && waistIsHigh && treatment.surgicalOption) {
                therapies.push(treatment.surgicalOption);
            }

            const therapiesHTML = therapies.map(t => `
                <div class="therapy-mini">
                    <div><strong>${t.name}:</strong> ${t.desc}</div>
                </div>
            `).join('');

            const card = document.createElement('div');
            card.className = 'factor-treatment indicated';
            card.id = treatment.id;
            card.setAttribute('data-field', factor);
            card.innerHTML = `
                <div class="factor-header">
                    <span class="material-icons-round factor-icon">${treatment.icon}</span>
                    <h5>${treatment.title}</h5>
                </div>
                <div class="factor-therapies">${therapiesHTML}</div>
            `;
            container.appendChild(card);
        });
    };

    /**
     * EID KBB: Render beta-vector arrows on each input label.
     */
    const renderBetaVectors = () => {
        const B = CONFIG.BETAS;
        const absBetas = Object.entries(B)
            .filter(([k]) => k !== 'sigma')
            .map(([, v]) => Math.abs(v));
        const maxBeta = Math.max(...absBetas);

        Object.entries(B).forEach(([key, beta]) => {
            if (key === 'sigma') return;
            const vecEl = el(`beta-vector-${key}`);
            if (!vecEl) return;

            const isPositive = beta > 0;
            const magnitude  = Math.abs(beta) / maxBeta;

            let sizeLabel;
            if      (magnitude > 0.5) sizeLabel = 'strong';
            else if (magnitude > 0.15) sizeLabel = 'moderate';
            else                       sizeLabel = 'weak';

            vecEl.className = `beta-vector ${isPositive ? 'risk-up' : 'protective'}`;
            vecEl.setAttribute('data-arrow', isPositive ? '↑' : '↓');
            vecEl.setAttribute('data-label', `(${sizeLabel})`);
            vecEl.title = `Model weight: ${beta.toFixed(4)} – ${isPositive ? 'increases' : 'decreases'} risk (${sizeLabel})`;
        });
    };

    /**
     * EID KBB: Update a single What-If badge with the current delta.
     */
    const renderWhatIfBadge = (field, delta) => {
        const badge = el(`what-if-${field}`);
        if (!badge) return;

        if (Math.abs(delta) < 0.01) {
            badge.className = 'what-if-badge';
            badge.textContent = '';
            return;
        }

        const sign    = delta > 0 ? '+' : '';
        const cssClass = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-neutral';

        badge.textContent = `${sign}${delta.toFixed(2)}%`;
        badge.className   = `what-if-badge visible ${cssClass}`;
    };

    /**
     * Änderung 1: Render Icon Array (Pictograph) with 100 people icons
     */
    const renderIconArray = (riskPct) => {
        const container = el('icon-array');
        const label = el('icon-array-label');
        if (!container) return;

        container.innerHTML = '';
        const affectedCount = Math.round(riskPct);

        for (let i = 0; i < 100; i++) {
            const icon = document.createElement('div');
            icon.className = 'icon-array-item';
            if (i < affectedCount) {
                icon.classList.add('affected');
            }
            container.appendChild(icon);
        }

        if (label) {
            label.textContent = `${affectedCount} out of 100 people with your profile may develop diabetes within 9 years`;
        }
    };

    /**
     * Änderung 2: Render Causality Chains
     */
    const renderCausalityChains = (siVals, elevatedFactors) => {
        const container = el('causality-chain');
        if (!container) return;

        container.innerHTML = '';

        const chains = [
            {
                label: 'Waist ↑',
                factors: ['waist'],
                nodes: ['Waist Size', 'Insulin Resistance ↑', 'Blood Sugar ↑', 'Diabetes Risk ↑']
            },
            {
                label: 'HDL ↓',
                factors: ['cholHDL'],
                nodes: ['HDL Cholesterol ↓', 'Lipid Metabolism ↓', 'Vascular Health ↓', 'Diabetes Risk ↑']
            },
            {
                label: 'Glucose ↑',
                factors: ['fastGlu'],
                nodes: ['Fasting Glucose ↑', 'Pancreatic Beta Cell Stress', 'Insulin Secretion ↓', 'Diabetes Risk ↑']
            },
            {
                label: 'BP ↑',
                factors: ['sbp'],
                nodes: ['Blood Pressure ↑', 'Vascular Dysfunction', 'Endothelial Damage', 'Diabetes Risk ↑']
            }
        ];

        chains.forEach(chain => {
            const isHighlighted = chain.factors.some(f => elevatedFactors.includes(f));

            const chainEl = document.createElement('div');
            chainEl.className = `causality-chain ${isHighlighted ? 'highlighted' : ''}`;

            chain.nodes.forEach((node, idx) => {
                const nodeEl = document.createElement('div');
                nodeEl.className = 'chain-node';
                nodeEl.textContent = node;
                chainEl.appendChild(nodeEl);

                if (idx < chain.nodes.length - 1) {
                    const arrow = document.createElement('div');
                    arrow.className = 'chain-arrow';
                    arrow.textContent = '→';
                    chainEl.appendChild(arrow);
                }
            });

            container.appendChild(chainEl);
        });
    };

    /**
     * Änderung 4: Render Scenario Comparison
     */
    const renderScenarioComparison = (baselineRisk, currentRisk) => {
        const panel = el('scenario-comparison');
        if (!panel) return;

        const delta = currentRisk - baselineRisk;
        const deltaClass = delta < 0 ? 'improved' : 'worsened';

        panel.innerHTML = `
            <div class="scenario-item baseline">
                <div class="scenario-label">Baseline</div>
                <div class="scenario-value">${baselineRisk.toFixed(1)}%</div>
            </div>
            <div class="scenario-delta">
                <span class="material-icons-round">arrow_forward</span>
            </div>
            <div class="scenario-item current">
                <div class="scenario-label">Current</div>
                <div class="scenario-value">${currentRisk.toFixed(1)}%</div>
            </div>
            <div class="scenario-delta">
                <div class="scenario-delta-value ${deltaClass}">
                    ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%
                </div>
            </div>
        `;
    };

    /**
     * Update Non-Modifiable Summary
     */
    const updateNonModSummary = () => {
        const age = el('age-value')?.value || '50';
        const race = el('race-toggle')?.checked ? 'Black' : 'Other';
        const parent = el('parentHist-toggle')?.checked ? 'Family history' : 'No family hist.';
        const heightVal = el('height-value')?.value || '66';
        const heightUnit = el('height-value-unit')?.textContent || 'in';

        const summaryAge = document.getElementById('summary-age');
        const summaryRace = document.getElementById('summary-race');
        const summaryParent = document.getElementById('summary-parent');
        const summaryHeight = document.getElementById('summary-height');

        if (summaryAge) summaryAge.textContent = 'Age: ' + age;
        if (summaryRace) summaryRace.textContent = race;
        if (summaryParent) summaryParent.textContent = parent;
        if (summaryHeight) summaryHeight.textContent = heightVal + ' ' + heightUnit;
    };

    return {
        readInputs,
        updateUnitLabels,
        updateSliderRanges,
        applyConvertedValues,
        updateSliderFill,
        updateAllSliderFills,
        renderRisk,
        renderContributionChart,
        renderHeatmapPointer,
        renderTreatmentRecommendations,
        renderBetaVectors,
        renderWhatIfBadge,
        renderIconArray,
        renderCausalityChains,
        renderScenarioComparison,
        updateNonModSummary
    };
})();


// ============================================
// 4. RADAR CHART  (EID RBB – Configural Display)
// ============================================

const RadarChart = (() => {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const CENTER = 150;
    const RADIUS = 115;
    const AXES   = ['fastGlu', 'sbp', 'cholTri', 'waist', 'cholHDL', 'age'];
    const N      = AXES.length;

    const normalizeAxis = (field, siValue) => {
        const ranges = CONFIG.RANGES[field].si;
        const [min, max] = [ranges[0], ranges[1]];
        let ratio = (siValue - min) / (max - min);
        ratio = Math.min(Math.max(ratio, 0), 1);
        if (field === 'cholHDL') ratio = 1 - ratio;
        return ratio;
    };

    const polarToXY = (i, r) => {
        const angle = (Math.PI * 2 * i / N) - Math.PI / 2;
        return {
            x: CENTER + r * Math.cos(angle),
            y: CENTER + r * Math.sin(angle)
        };
    };

    const toPointsStr = (points) =>
        points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    const init = () => {
        const svg = document.getElementById('radar-svg');
        if (!svg) return;
        svg.innerHTML = '';

        [0.2, 0.4, 0.6, 0.8, 1.0].forEach(frac => {
            const ring = document.createElementNS(SVG_NS, 'polygon');
            const pts  = AXES.map((_, i) => polarToXY(i, RADIUS * frac));
            ring.setAttribute('points', toPointsStr(pts));
            ring.setAttribute('class', 'radar-ring');
            svg.appendChild(ring);
        });

        AXES.forEach((_, i) => {
            const { x, y } = polarToXY(i, RADIUS);
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', CENTER);
            line.setAttribute('y1', CENTER);
            line.setAttribute('x2', x);
            line.setAttribute('y2', y);
            line.setAttribute('class', 'radar-axis');
            svg.appendChild(line);
        });

        const idealPoly = document.createElementNS(SVG_NS, 'polygon');
        idealPoly.setAttribute('id', 'radar-ideal-poly');
        idealPoly.setAttribute('class', 'radar-ideal');
        svg.appendChild(idealPoly);

        const populationPoly = document.createElementNS(SVG_NS, 'polygon');
        populationPoly.setAttribute('id', 'radar-population-poly');
        populationPoly.setAttribute('class', 'radar-population');
        svg.appendChild(populationPoly);

        const patientPoly = document.createElementNS(SVG_NS, 'polygon');
        patientPoly.setAttribute('id', 'radar-patient-poly');
        patientPoly.setAttribute('class', 'radar-patient');
        svg.appendChild(patientPoly);

        AXES.forEach((field, i) => {
            const dot = document.createElementNS(SVG_NS, 'circle');
            dot.setAttribute('id', `radar-dot-${field}`);
            dot.setAttribute('class', 'radar-dot');
            dot.setAttribute('r', '4');
            dot.setAttribute('cx', CENTER);
            dot.setAttribute('cy', CENTER);
            svg.appendChild(dot);
        });

        AXES.forEach((field, i) => {
            const { x, y } = polarToXY(i, RADIUS + 18);
            const label = document.createElementNS(SVG_NS, 'text');
            label.setAttribute('x', x);
            label.setAttribute('y', y);
            label.setAttribute('class', 'radar-label');
            label.textContent = CONFIG.RADAR_LABELS[field] || field;
            svg.appendChild(label);
        });

        const idealPoints = AXES.map((field, i) => {
            const norm = normalizeAxis(field, CONFIG.MEANS[field]);
            return polarToXY(i, RADIUS * norm);
        });
        idealPoly.setAttribute('points', toPointsStr(idealPoints));

        // Population average points (identical to ideal in this model)
        const popPoly = document.getElementById('radar-population-poly');
        if (popPoly) {
            popPoly.setAttribute('points', toPointsStr(idealPoints));
        }
    };

    const render = (siVals, elevatedFactors = []) => {
        const svg = document.getElementById('radar-svg');
        if (!svg) return;

        const patientPoly = document.getElementById('radar-patient-poly');
        if (!patientPoly) return;

        const points = AXES.map((field, i) => {
            const norm = normalizeAxis(field, siVals[field]);
            const pt   = polarToXY(i, RADIUS * norm);

            const dot = document.getElementById(`radar-dot-${field}`);
            if (dot) {
                dot.setAttribute('cx', pt.x.toFixed(1));
                dot.setAttribute('cy', pt.y.toFixed(1));
                dot.classList.toggle('elevated', elevatedFactors.includes(field));
            }

            return pt;
        });

        patientPoly.setAttribute('points', toPointsStr(points));
    };

    return { init, render, AXES };
})();


// ============================================
// 5. TIMELINE CHART  (EID Trend Visualization)
// ============================================

const TimelineChart = (() => {
    const SVG_NS    = 'http://www.w3.org/2000/svg';
    const snapshots = [];
    const MAX_SNAPSHOTS = 20;

    const addSnapshot = (riskPct, siVals) => {
        if (snapshots.length >= MAX_SNAPSHOTS) snapshots.shift();
        snapshots.push({
            timestamp: new Date(),
            riskPct,
            siVals: { ...siVals }
        });
        render();
    };

    const render = () => {
        const container = document.getElementById('timeline-chart');
        if (!container) return;

        if (snapshots.length === 0) {
            container.innerHTML = '<p class="timeline-empty">No snapshots yet. Click "Save Snapshot" to track changes over time.</p>';
            return;
        }

        const W = container.offsetWidth - 48 || 250;
        const H = 80;
        const PAD = { top: 10, right: 12, bottom: 16, left: 12 };

        const plotW = W - PAD.left - PAD.right;
        const plotH = H - PAD.top - PAD.bottom;

        const maxY = Math.max(50, ...snapshots.map(s => s.riskPct));

        const xScale = (i) => PAD.left + (snapshots.length === 1 ? plotW / 2 : (i / (snapshots.length - 1)) * plotW);
        const yScale = (v) => PAD.top + plotH - (v / maxY) * plotH;

        let svgHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;

        // Threshold line at 10%
        const threshY = yScale(10);
        svgHTML += `<line x1="${PAD.left}" y1="${threshY}" x2="${W - PAD.right}" y2="${threshY}" class="timeline-threshold"/>`;
        svgHTML += `<text x="${W - PAD.right + 2}" y="${threshY + 3}" class="timeline-label">10%</text>`;

        if (snapshots.length > 1) {
            let areaD = `M ${xScale(0)} ${yScale(snapshots[0].riskPct)}`;
            snapshots.forEach((s, i) => { areaD += ` L ${xScale(i)} ${yScale(s.riskPct)}`; });
            areaD += ` L ${xScale(snapshots.length - 1)} ${yScale(0)} L ${xScale(0)} ${yScale(0)} Z`;
            svgHTML += `<path d="${areaD}" class="timeline-area"/>`;
        }

        if (snapshots.length > 1) {
            let lineD = `M ${xScale(0)} ${yScale(snapshots[0].riskPct)}`;
            snapshots.forEach((s, i) => { lineD += ` L ${xScale(i)} ${yScale(s.riskPct)}`; });
            svgHTML += `<path d="${lineD}" class="timeline-line"/>`;
        }

        snapshots.forEach((s, i) => {
            const cx = xScale(i);
            const cy = yScale(s.riskPct);
            svgHTML += `<circle cx="${cx}" cy="${cy}" r="4" class="timeline-dot"><title>#${i + 1}: ${s.riskPct.toFixed(1)}%</title></circle>`;
            if (i === 0 || i === snapshots.length - 1 || i % 5 === 0) {
                svgHTML += `<text x="${cx}" y="${H - 2}" class="timeline-label" text-anchor="middle">${i + 1}</text>`;
            }
        });

        svgHTML += `</svg>`;
        container.innerHTML = svgHTML;
    };

    const clear = () => {
        snapshots.length = 0;
        render();
    };

    return { addSnapshot, render, clear };
})();


// ============================================
// 6. APPLICATION STATE & COORDINATION
// ============================================

const App = (() => {

    const state = {
        isMetric:    false,
        prevRiskPct: null,
        activeField: null,
        baselineRisk: null,
        isComparingScenario: false
    };

    let _activeHighlightField = null;

    const reapplyHighlight = () => {
        if (!_activeHighlightField) return;
        document.querySelectorAll(`[data-field="${_activeHighlightField}"]`)
            .forEach(n => n.classList.add('factor-highlight'));
    };

    const calculate = () => {
        const rawInputs = UIController.readInputs();
        const siVals    = RiskModel.toSI(rawInputs, state.isMetric);

        const probability     = RiskModel.computeProbability(siVals);
        const riskPct         = probability * 100;
        const contributions   = RiskModel.computeContributions(siVals);
        const treatmentStatus = RiskModel.getElevatedFactors(siVals, rawInputs, state.isMetric);

        UIController.renderRisk(riskPct);
        UIController.updateNonModSummary();
        UIController.renderIconArray(riskPct);
        UIController.renderContributionChart(contributions);
        UIController.renderHeatmapPointer(contributions);
        UIController.renderTreatmentRecommendations(treatmentStatus, contributions);
        UIController.renderCausalityChains(siVals, treatmentStatus.elevatedFactors);

        RadarChart.render(siVals, treatmentStatus.elevatedFactors);

        if (state.isComparingScenario && state.baselineRisk !== null) {
            UIController.renderScenarioComparison(state.baselineRisk, riskPct);
        }

        if (state.activeField && state.prevRiskPct !== null) {
            const delta = riskPct - state.prevRiskPct;
            UIController.renderWhatIfBadge(state.activeField, delta);
        }

        reapplyHighlight();

        return riskPct;
    };

    const onSliderInput = (field) => {
        const slider = document.getElementById(`${field}-slider`);
        const input  = document.getElementById(`${field}-value`);
        if (slider && input) input.value = slider.value;
        UIController.updateSliderFill(field);
        state.activeField = field;
        calculate();
    };

    const onSliderStart = (field) => {
        state.activeField = field;
        const rawInputs = UIController.readInputs();
        const siVals    = RiskModel.toSI(rawInputs, state.isMetric);
        state.prevRiskPct = RiskModel.computeProbability(siVals) * 100;
    };

    const onSliderEnd = (field) => {
        setTimeout(() => {
            const badge = document.getElementById(`what-if-${field}`);
            if (badge) badge.className = 'what-if-badge';
        }, 2000);
        state.prevRiskPct = null;
        state.activeField = null;
    };

    const onValueChange = (field) => {
        const slider = document.getElementById(`${field}-slider`);
        const input  = document.getElementById(`${field}-value`);
        if (!slider || !input) return;

        let val = parseFloat(input.value);
        val = Math.min(Math.max(val, parseFloat(slider.min)), parseFloat(slider.max));
        input.value  = val;
        slider.value = val;

        UIController.updateSliderFill(field);
        calculate();
    };

    const onToggleUnits = () => {
        const prevMetric = state.isMetric;
        state.isMetric   = document.getElementById('unit-toggle').checked;
        if (prevMetric === state.isMetric) return;

        const fieldsToConvert = ['height', 'waist', 'fastGlu', 'cholHDL', 'cholTri'];
        const snapshot = {};
        fieldsToConvert.forEach(f => {
            snapshot[f] = parseFloat(document.getElementById(`${f}-value`).value);
        });

        UIController.updateUnitLabels(state.isMetric);
        UIController.updateSliderRanges(state.isMetric ? 'si' : 'us');
        UIController.applyConvertedValues(snapshot, state.isMetric);
        UIController.updateAllSliderFills();
        calculate();
    };

    const onReset = () => {
        const D = CONFIG.DEFAULTS;

        document.getElementById('unit-toggle').checked = false;
        state.isMetric = false;
        UIController.updateUnitLabels(false);
        UIController.updateSliderRanges('us');

        const setField = (field, val) => {
            document.getElementById(`${field}-slider`).value = val;
            document.getElementById(`${field}-value`).value  = val;
        };

        setField('age',     D.age);
        setField('sbp',     D.sbp);
        setField('height',  D.height.us);
        setField('waist',   D.waist.us);
        setField('fastGlu', D.fastGlu.us);
        setField('cholHDL', D.cholHDL.us);
        setField('cholTri', D.cholTri.us);

        document.getElementById('race-toggle').checked      = D.race;
        document.getElementById('parentHist-toggle').checked = D.parentHist;

        ['age', 'height', 'waist', 'sbp', 'fastGlu', 'cholHDL', 'cholTri'].forEach(f => {
            const badge = document.getElementById(`what-if-${f}`);
            if (badge) badge.className = 'what-if-badge';
        });

        UIController.updateAllSliderFills();
        TimelineChart.clear();
        calculate();
    };

    const onSnapshot = () => {
        const rawInputs = UIController.readInputs();
        const siVals    = RiskModel.toSI(rawInputs, state.isMetric);
        const riskPct   = RiskModel.computeProbability(siVals) * 100;
        TimelineChart.addSnapshot(riskPct, siVals);
    };

    const onCompareScenario = () => {
        const rawInputs = UIController.readInputs();
        const siVals    = RiskModel.toSI(rawInputs, state.isMetric);
        const currentRisk = RiskModel.computeProbability(siVals) * 100;

        state.isComparingScenario = !state.isComparingScenario;

        if (state.isComparingScenario) {
            state.baselineRisk = currentRisk;
            const btn = document.getElementById('compareScenarioBtn');
            if (btn) {
                btn.classList.add('active');
                btn.style.background = 'var(--blue)';
                btn.style.color = 'white';
            }
            const panel = document.getElementById('scenario-comparison');
            if (panel) panel.style.display = 'flex';
            UIController.renderScenarioComparison(state.baselineRisk, currentRisk);
        } else {
            state.baselineRisk = null;
            const btn = document.getElementById('compareScenarioBtn');
            if (btn) {
                btn.classList.remove('active');
                btn.style.background = 'var(--blue-light)';
                btn.style.color = 'var(--blue)';
            }
            const panel = document.getElementById('scenario-comparison');
            if (panel) panel.style.display = 'none';
        }
    };

    const init = () => {
        const sliderFields = ['age', 'sbp', 'height', 'waist', 'fastGlu', 'cholHDL', 'cholTri'];

        sliderFields.forEach(field => {
            const slider = document.getElementById(`${field}-slider`);
            if (!slider) return;

            slider.addEventListener('input',      () => onSliderInput(field));
            slider.addEventListener('mousedown',  () => onSliderStart(field));
            slider.addEventListener('touchstart', () => onSliderStart(field), { passive: true });
            slider.addEventListener('mouseup',    () => onSliderEnd(field));
            slider.addEventListener('touchend',   () => onSliderEnd(field));
        });

        sliderFields.forEach(field => {
            const input = document.getElementById(`${field}-value`);
            if (input) input.addEventListener('change', () => onValueChange(field));
        });

        ['race-toggle', 'parentHist-toggle'].forEach(id => {
            const node = document.getElementById(id);
            if (node) node.addEventListener('change', calculate);
        });

        const unitToggle = document.getElementById('unit-toggle');
        if (unitToggle) unitToggle.addEventListener('change', onToggleUnits);

        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) resetBtn.addEventListener('click', onReset);

        const snapshotBtn = document.getElementById('snapshotBtn');
        if (snapshotBtn) snapshotBtn.addEventListener('click', onSnapshot);

        const compareScenarioBtn = document.getElementById('compareScenarioBtn');
        if (compareScenarioBtn) compareScenarioBtn.addEventListener('click', onCompareScenario);

        UIController.renderBetaVectors();
        RadarChart.init();
        UIController.updateAllSliderFills();
        calculate();

        // "What does that mean?" expand toggle
        const expandHeroBtn = document.getElementById('expandHeroBtn');
        const heroExpandable = document.getElementById('hero-expandable');
        if (expandHeroBtn && heroExpandable) {
            expandHeroBtn.addEventListener('click', () => {
                const isOpen = heroExpandable.classList.toggle('open');
                expandHeroBtn.classList.toggle('open', isOpen);
                expandHeroBtn.setAttribute('aria-expanded', isOpen);
            });
        }

        // Cross-panel factor highlight on hover
        document.addEventListener('mouseover', (e) => {
            const fieldEl = e.target.closest('[data-field]');
            const field = fieldEl ? fieldEl.getAttribute('data-field') : null;
            if (field === _activeHighlightField) return;
            if (_activeHighlightField) {
                document.querySelectorAll(`[data-field="${_activeHighlightField}"]`)
                    .forEach(n => n.classList.remove('factor-highlight'));
            }
            _activeHighlightField = field;
            if (field) {
                document.querySelectorAll(`[data-field="${field}"]`)
                    .forEach(n => n.classList.add('factor-highlight'));
            }
        });

        // --- Model Column Tab Navigation ---
        document.querySelectorAll('.model-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Deactivate all tabs
                document.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.model-tab-content').forEach(c => c.classList.remove('active'));
                // Activate clicked tab
                tab.classList.add('active');
                const targetId = 'tab-' + tab.getAttribute('data-tab');
                const targetContent = document.getElementById(targetId);
                if (targetContent) targetContent.classList.add('active');
            });
        });

        // --- Collapsible Sections ---
        document.querySelectorAll('.section-collapse-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target');
                const target = document.getElementById(targetId);
                if (!target) return;

                const isCollapsed = target.classList.toggle('collapsed');
                btn.classList.toggle('collapsed', isCollapsed);

                // Toggle summary visibility for non-modifiable section
                if (targetId === 'non-mod-section') {
                    const summary = document.getElementById('non-mod-summary');
                    if (summary) summary.classList.toggle('visible', isCollapsed);
                }
            });
        });

        // Set non-modifiable section initially collapsed
        const nonModSection = document.getElementById('non-mod-section');
        const nonModBtn = document.querySelector('[data-target="non-mod-section"]');
        const nonModSummary = document.getElementById('non-mod-summary');
        if (nonModSection) nonModSection.classList.add('collapsed');
        if (nonModBtn) nonModBtn.classList.add('collapsed');
        if (nonModSummary) nonModSummary.classList.add('visible');
    };

    return { init };
})();


// ============================================
// 7. BOOTSTRAP
// ============================================

document.addEventListener('DOMContentLoaded', App.init);
