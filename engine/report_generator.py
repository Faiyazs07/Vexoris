import io
from typing import Dict, Any
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

def generate_forensic_pdf(audit_data: Dict[str, Any]) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()
    
    # Custom Industrial Dark Theme Styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#00F0FF'),
        spaceAfter=6
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        textColor=colors.HexColor('#8A8D93'),
        spaceAfter=12
    )
    
    body_bold = ParagraphStyle(
        'BodyBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        textColor=colors.HexColor('#111622')
    )

    story = []

    # 1. Header & Metadata
    story.append(Paragraph("VEXORIS // DETERMINISTIC SPATIAL INCIDENT AUDIT", title_style))
    story.append(Paragraph(f"Node ID: {audit_data.get('node_id')} | Hash: 0x8F3A92C... | Generated: 2026-08-05 T23:26:00Z", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#00F0FF'), spaceAfter=15))

    # 2. Key Telemetry Metrics Table
    table_data = [
        [Paragraph("Metric Parameter", body_bold), Paragraph("Observed State at Incident", body_bold), Paragraph("Nominal Baseline", body_bold)],
        ["Microsecond Timestamp", f"t = {audit_data.get('timestamp'):.3f}s", "14.000s - 14.050s"],
        ["Incident Severity", audit_data.get("status"), "NOMINAL"],
        ["Vision Neural Confidence", f"{audit_data.get('model_weight', 0)*100:.0f}%", "98% - 100%"],
        ["Optical Glare Saturation Index", f"{audit_data.get('glare_index', 0):.2f}", "< 0.08"],
        ["Active LiDAR Point Cloud Count", f"{audit_data.get('lidar_points')} PTS", "4000 PTS"],
        ["Isolated Root Cause Node", audit_data.get("camera_node_id", "CAM_NODE_2"), "ALL NODES OK"]
    ]

    t = Table(table_data, colWidths=[180, 180, 180])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F0F4F8')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#111622')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D0D7DE')),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 15))

    # 3. Diagnostic Summary & Remediation
    story.append(Paragraph("DETERMINISTIC ROOT CAUSE DIAGNOSIS", body_bold))
    story.append(Spacer(1, 5))
    detail_text = audit_data.get("anomaly_detail", "Optical Sensor Saturation at Camera Node #2 due to direct solar glare spike.")
    story.append(Paragraph(f"<b>Root Cause:</b> {detail_text}", styles['Normal']))
    story.append(Spacer(1, 10))

    story.append(Paragraph("RECOMMENDED HARDWARE & MODEL REMEDIATION", body_bold))
    story.append(Spacer(1, 5))
    story.append(Paragraph("1. Enforce 12ms hard exposure cap on Camera Node #2 firmware.", styles['Normal']))
    story.append(Paragraph("2. Inject saturation glare profiles into vision model retrain pipeline.", styles['Normal']))

    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()