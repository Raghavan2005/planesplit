from reportlab.lib.pagesizes import landscape, letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.colors import HexColor

def generate_presentation():
    doc = SimpleDocTemplate("PlaneSplit_Presentation.pdf", pagesize=landscape(letter),
                            rightMargin=50, leftMargin=50, topMargin=50, bottomMargin=50)
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'TitleStyle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=32,
        spaceAfter=20,
        alignment=TA_CENTER,
        textColor=HexColor("#1e293b")
    )
    
    subtitle_style = ParagraphStyle(
        'SubtitleStyle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=18,
        spaceAfter=40,
        alignment=TA_CENTER,
        textColor=HexColor("#475569")
    )
    
    slide_title_style = ParagraphStyle(
        'SlideTitleStyle',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=24,
        spaceAfter=20,
        textColor=HexColor("#0f172a"),
        borderPadding=(0, 0, 10, 0)
    )
    
    bullet_style = ParagraphStyle(
        'BulletStyle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=16,
        leading=24,
        spaceAfter=10,
        bulletIndent=20,
        leftIndent=40
    )

    story = []

    # Slide 1: Title
    story.append(Spacer(1, 100))
    story.append(Paragraph("PlaneSplit", title_style))
    story.append(Paragraph("Control-Plane and Data-Plane Consistency Verification", subtitle_style))
    story.append(Paragraph("Raghavan -> Number 31", subtitle_style))
    story.append(PageBreak())

    # Slide 2: Problem Statement #31
    story.append(Spacer(1, 30))
    story.append(Paragraph("Problem Statement #31", slide_title_style))
    bullets = [
        "Modern networks rely on two independent layers: Control Plane (Intent) and Data Plane (Physical state).",
        "Updates to the network are not instantaneous.",
        "Divergence occurs when the intended routing rules (RIB) do not match the physical hardware rules (FIB).",
        "This divergence causes packet loss, routing loops, and security blackholes.",
        "Our Goal: Detect this divergence actively without relying solely on static configuration diffs."
    ]
    for b in bullets:
        story.append(Paragraph(f"• {b}", bullet_style))
    story.append(PageBreak())

    # Slide 3: Our Solution Architecture
    story.append(Spacer(1, 30))
    story.append(Paragraph("Solution Architecture", slide_title_style))
    bullets = [
        "A Pure Software Model built in Python (FastAPI).",
        "Strict separation of RIB (Control Plane) and FIB (Data Plane) at the routing level.",
        "Longest Prefix Match (LPM) algorithms resolve next-hops exactly like physical hardware.",
        "Instead of diffing configs, we inject active simulated probes to trace the actual path.",
        "WebSocket streaming pushes real-time telemetry to the visualization layer."
    ]
    for b in bullets:
        story.append(Paragraph(f"• {b}", bullet_style))
    story.append(PageBreak())

    # Slide 4: Active Boundary Probing
    story.append(Spacer(1, 30))
    story.append(Paragraph("Active Boundary Probing", slide_title_style))
    bullets = [
        "We simulate packets sent to the network boundaries (e.g., first and last IP of a subnet).",
        "Control Plane Probe traces the path using the intended RIB rules.",
        "Data Plane Probe traces the path using the actual FIB hardware rules.",
        "If paths diverge, the Verification Engine triggers a realtime Alert.",
        "Handles edge cases like subnet corruption (/25 vs /24) which static diffs might miss."
    ]
    for b in bullets:
        story.append(Paragraph(f"• {b}", bullet_style))
    story.append(PageBreak())

    # Slide 5: 3D Visualization
    story.append(Spacer(1, 30))
    story.append(Paragraph("3D 'Packet Rider' Visualization", slide_title_style))
    bullets = [
        "Built with React, Three.js, and React Three Fiber.",
        "Provides a 'AAA Cyberpunk' aesthetic for maximum presentation impact.",
        "Green Hologram tracks represent Control Plane intent.",
        "Red/Blue solid tracks represent the physical Data Plane reality.",
        "Discrete packet particle explosions provide immediate feedback on success vs. dropped packets.",
        "Hardware faults trigger dynamic glowing alerts on the 3D Server Racks."
    ]
    for b in bullets:
        story.append(Paragraph(f"• {b}", bullet_style))
    story.append(PageBreak())

    # Slide 6: Demo Scenarios
    story.append(Spacer(1, 30))
    story.append(Paragraph("Live Demo Scenarios", slide_title_style))
    bullets = [
        "1. Normal Convergence: Network seamlessly shifts traffic to the AWS ALB.",
        "2. Injected Delay: Simulated 2-second propagation delay. Yellow pulsing rack, temporary divergence, auto-recovers.",
        "3. Injected Drop: Packet physically drops off the track. Red flashing rack, permanent divergence alert.",
        "4. Corrupted Mask: Shows /25 vs /24 misconfiguration caught by boundary probing."
    ]
    for b in bullets:
        story.append(Paragraph(f"• {b}", bullet_style))
    story.append(PageBreak())

    # Slide 7: Conclusion
    story.append(Spacer(1, 100))
    story.append(Paragraph("Thank You", title_style))
    story.append(Paragraph("Ready for Live Demonstration", subtitle_style))

    doc.build(story)

if __name__ == "__main__":
    generate_presentation()
