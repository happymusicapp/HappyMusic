package com.happymusic.app;

import java.util.ArrayList;
import java.util.List;

/**
 * Medidor de volume percebido (LUFS integrado, ITU-R BS.1770 com portas de
 * EBU R128), em Java puro — sem nada do Android, de propósito, pra poder
 * ser testado no computador.
 *
 * Uso: crie um medidor por faixa, chame addInterleaved() com o áudio já
 * decodificado (PCM em float, -1..1, canais intercalados), chame
 * endSegment() ao fim de cada trecho analisado (trechos não se misturam
 * nos blocos de 400 ms) e, no fim, integratedLufs().
 *
 * Mono é tratado como "dual mono" (mesmo sinal nos dois lados): é assim
 * que ele sai nas caixas, então é assim que ele soa.
 */
final class LoudnessMeter {

    private static final double ABSOLUTE_GATE_LUFS = -70.0;
    private static final double RELATIVE_GATE_LU = -10.0;
    private static final int SUBBLOCKS_PER_BLOCK = 4; // blocos de 400 ms, passo de 100 ms

    private final int sampleRate;
    private final int usedChannels;       // 1 ou 2 (canais além do 2º são ignorados)
    private final int subBlockFrames;     // 100 ms

    // Filtros K-weighting (por canal): estágio 1 (shelf agudo) e 2 (passa-altas)
    private final double[] s1b = new double[3], s1a = new double[3];
    private final double[] s2b = new double[3], s2a = new double[3];
    private final double[][] s1x = new double[2][2], s1y = new double[2][2];
    private final double[][] s2x = new double[2][2], s2y = new double[2][2];

    private final double[] subSum = new double[2];
    private int subFrames = 0;

    /** Energia média (soma dos canais) de cada sub-bloco de 100 ms, em ordem. */
    private final List<Double> subEnergy = new ArrayList<>();
    /** Índices em subEnergy onde cada trecho começa. */
    private final List<Integer> segmentStarts = new ArrayList<>();

    private float peak = 0f;

    LoudnessMeter(int sampleRate, int channels) {
        if (sampleRate < 8000) throw new IllegalArgumentException("sampleRate");
        this.sampleRate = sampleRate;
        this.usedChannels = channels >= 2 ? 2 : 1;
        this.subBlockFrames = Math.max(1, sampleRate / 10);
        designFilters();
        segmentStarts.add(0);
    }

    // Coeficientes do BS.1770-4 para qualquer taxa de amostragem.
    private void designFilters() {
        double fs = sampleRate;

        double f0 = 1681.974450955533, g = 3.999843853973347, q = 0.7071752369554196;
        double k = Math.tan(Math.PI * f0 / fs);
        double vh = Math.pow(10.0, g / 20.0);
        double vb = Math.pow(vh, 0.4996667741545416);
        double a0 = 1.0 + k / q + k * k;
        s1b[0] = (vh + vb * k / q + k * k) / a0;
        s1b[1] = 2.0 * (k * k - vh) / a0;
        s1b[2] = (vh - vb * k / q + k * k) / a0;
        s1a[0] = 1.0;
        s1a[1] = 2.0 * (k * k - 1.0) / a0;
        s1a[2] = (1.0 - k / q + k * k) / a0;

        f0 = 38.13547087602444;
        q = 0.5003270373238773;
        k = Math.tan(Math.PI * f0 / fs);
        a0 = 1.0 + k / q + k * k;
        s2b[0] = 1.0;
        s2b[1] = -2.0;
        s2b[2] = 1.0;
        s2a[0] = 1.0;
        s2a[1] = 2.0 * (k * k - 1.0) / a0;
        s2a[2] = (1.0 - k / q + k * k) / a0;
    }

    /**
     * @param data     amostras intercaladas (frame0_ch0, frame0_ch1, ...)
     * @param frames   quantos frames ler
     * @param channels quantos canais há em 'data' (pode ser > usedChannels)
     */
    void addInterleaved(float[] data, int frames, int channels) {
        if (channels < 1) return;
        for (int f = 0; f < frames; f++) {
            int base = f * channels;
            for (int c = 0; c < usedChannels; c++) {
                float v = data[base + (c < channels ? c : 0)];
                float av = Math.abs(v);
                if (av > peak) peak = av;
                double x = v;

                // estágio 1
                double y1 = s1b[0] * x + s1b[1] * s1x[c][0] + s1b[2] * s1x[c][1]
                        - s1a[1] * s1y[c][0] - s1a[2] * s1y[c][1];
                s1x[c][1] = s1x[c][0]; s1x[c][0] = x;
                s1y[c][1] = s1y[c][0]; s1y[c][0] = y1;

                // estágio 2
                double y2 = s2b[0] * y1 + s2b[1] * s2x[c][0] + s2b[2] * s2x[c][1]
                        - s2a[1] * s2y[c][0] - s2a[2] * s2y[c][1];
                s2x[c][1] = s2x[c][0]; s2x[c][0] = y1;
                s2y[c][1] = s2y[c][0]; s2y[c][0] = y2;

                subSum[c] += y2 * y2;
            }
            if (++subFrames >= subBlockFrames) closeSubBlock();
        }
    }

    private void closeSubBlock() {
        double total = 0.0;
        for (int c = 0; c < usedChannels; c++) total += subSum[c] / subFrames;
        if (usedChannels == 1) total *= 2.0; // dual mono
        subEnergy.add(total);
        subSum[0] = 0.0; subSum[1] = 0.0;
        subFrames = 0;
    }

    /** Encerra o trecho atual: descarta a sobra (< 100 ms) e zera os filtros. */
    void endSegment() {
        subSum[0] = 0.0; subSum[1] = 0.0;
        subFrames = 0;
        for (int c = 0; c < 2; c++) {
            s1x[c][0] = s1x[c][1] = s1y[c][0] = s1y[c][1] = 0.0;
            s2x[c][0] = s2x[c][1] = s2y[c][0] = s2y[c][1] = 0.0;
        }
        if (segmentStarts.get(segmentStarts.size() - 1) != subEnergy.size()) {
            segmentStarts.add(subEnergy.size());
        }
    }

    /** Pico de amostra (0..1+) visto até agora. */
    float samplePeak() { return peak; }

    /** Quantos sub-blocos de 100 ms já foram medidos. */
    int measuredSubBlocks() { return subEnergy.size(); }

    /** LUFS integrado, ou NaN se não houve áudio suficiente (menos de 400 ms). */
    double integratedLufs() {
        endSegment();
        List<Double> blocks = new ArrayList<>();
        for (int s = 0; s < segmentStarts.size(); s++) {
            int from = segmentStarts.get(s);
            int to = (s + 1 < segmentStarts.size()) ? segmentStarts.get(s + 1) : subEnergy.size();
            for (int i = from; i + SUBBLOCKS_PER_BLOCK <= to; i++) {
                double sum = 0.0;
                for (int k = 0; k < SUBBLOCKS_PER_BLOCK; k++) sum += subEnergy.get(i + k);
                blocks.add(sum / SUBBLOCKS_PER_BLOCK);
            }
        }
        if (blocks.isEmpty()) return Double.NaN;

        // Porta absoluta (-70 LUFS)
        double absSum = 0.0; int absCount = 0;
        for (double z : blocks) {
            if (toLufs(z) > ABSOLUTE_GATE_LUFS) { absSum += z; absCount++; }
        }
        if (absCount == 0) return Double.NaN;

        // Porta relativa (10 LU abaixo da média das que passaram na absoluta)
        double relGate = toLufs(absSum / absCount) + RELATIVE_GATE_LU;
        double sum = 0.0; int count = 0;
        for (double z : blocks) {
            if (toLufs(z) > ABSOLUTE_GATE_LUFS && toLufs(z) > relGate) { sum += z; count++; }
        }
        if (count == 0) return Double.NaN;
        return toLufs(sum / count);
    }

    private static double toLufs(double meanSquare) {
        if (meanSquare <= 0.0) return Double.NEGATIVE_INFINITY;
        return -0.691 + 10.0 * Math.log10(meanSquare);
    }
}
