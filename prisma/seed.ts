import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_DATA = [
  {
    name: 'AC Repair & Service',
    slug: 'ac-repair-service',
    description: 'Expert AC chemical wash, gas refill, compressor troubleshooting, and mounting.',
    iconUrl: '❄️',
    isFixedPrice: false,
    basePrice: 500,
    services: [
      {
        name: 'Split AC Master Chemical Wash',
        description: 'Complete high-pressure jet pump cleaning of indoor cooling coil, blower wheel, and outdoor condenser with antibacterial sanitization.',
        isFixedPrice: true,
        basePrice: 850,
        durationMin: 60,
      },
      {
        name: 'AC Refrigerant Gas Top-Up (R22 / R410 / R32)',
        description: 'Complete flare leak inspection, vacuuming, and pure OEM refrigerant gas recharging.',
        isFixedPrice: false,
        basePrice: 1800,
        durationMin: 45,
      },
      {
        name: 'AC Installation & Shifting Support',
        description: 'Precision wall mounting, bracket installation, copper piping connection, and cooling load testing.',
        isFixedPrice: true,
        basePrice: 1500,
        durationMin: 90,
      },
      {
        name: 'AC Electrical & PCB Circuit Repair',
        description: 'Capacitor replacement, PCB motherboard diagnostic, sensor repair, and wiring insulation.',
        isFixedPrice: false,
        basePrice: 650,
        durationMin: 45,
      },
      {
        name: 'AC Water Leakage & Drainage Clearing',
        description: 'Condensation tray clearing, drainage pipe unblocking, and insulation wrapping.',
        isFixedPrice: true,
        basePrice: 500,
        durationMin: 35,
      },
    ],
  },
  {
    name: 'Electrical & Wiring',
    slug: 'electrical-wiring',
    description: 'Certified electricians for short circuits, circuit breaker DB box, switches, and fans.',
    iconUrl: '⚡',
    isFixedPrice: false,
    basePrice: 350,
    services: [
      {
        name: 'Emergency Short Circuit & Trip Isolation',
        description: 'Locate faulty wiring loops, burned sockets, and replace defective MCB/RCCB breakers.',
        isFixedPrice: false,
        basePrice: 450,
        durationMin: 40,
      },
      {
        name: 'Ceiling Fan & Chandelier Hanging Setup',
        description: 'Heavy ceiling fastener anchor installation, wire concealment, and regulator balancing.',
        isFixedPrice: true,
        basePrice: 350,
        durationMin: 30,
      },
      {
        name: 'Main DB Distribution Box Overhaul',
        description: 'Load balancing, phase distributor replacement, and high-conductivity copper earth line connection.',
        isFixedPrice: false,
        basePrice: 1200,
        durationMin: 75,
      },
      {
        name: 'Switch & Smart Socket Replacement',
        description: 'Modular switchboard installation, gang switch wiring, and surge protection setup.',
        isFixedPrice: true,
        basePrice: 300,
        durationMin: 25,
      },
      {
        name: 'IPS & Generator Inverter Wiring Integration',
        description: 'Backup line isolation, automatic transfer switch (ATS) wiring, and battery terminal maintenance.',
        isFixedPrice: false,
        basePrice: 900,
        durationMin: 60,
      },
    ],
  },
  {
    name: 'Plumbing & Sanitary',
    slug: 'plumbing-sanitary',
    description: 'Concealed pipe leak repair, basin/commode replacement, water pump, and drain snaking.',
    iconUrl: '🔧',
    isFixedPrice: false,
    basePrice: 400,
    services: [
      {
        name: 'Pipe Line Leakage & Water Tap Replacement',
        description: 'Concealed CPVC/PPR pipe pressure testing, angle stop valve repair, and Teflon sealing.',
        isFixedPrice: true,
        basePrice: 400,
        durationMin: 35,
      },
      {
        name: 'Drainage Blockage Clearing & Machine Snaking',
        description: 'Heavy duty motorized snake auger clearing for kitchen sink, floor drain, and commode line.',
        isFixedPrice: false,
        basePrice: 750,
        durationMin: 45,
      },
      {
        name: 'Water Motor Pump Servicing & Float Switch',
        description: 'Centrifugal/submersible pump bearing replacement, capacitor fix, and auto overhead float switch.',
        isFixedPrice: false,
        basePrice: 950,
        durationMin: 60,
      },
      {
        name: 'Commode & Flush Tank Mechanism Overhaul',
        description: 'Syphon kit replacement, push button repair, wax ring leak prevention, and silicone base seal.',
        isFixedPrice: true,
        basePrice: 650,
        durationMin: 50,
      },
      {
        name: 'Bathroom Shower & Mixer Tap Installation',
        description: 'Concealed diverter fitting, rainfall shower head alignment, and hot/cold line calibration.',
        isFixedPrice: true,
        basePrice: 550,
        durationMin: 40,
      },
    ],
  },
  {
    name: 'Home Appliances',
    slug: 'home-appliances',
    description: 'Expert repair of Refrigerator, Washing Machine, Microwave Oven, TV, and Water Geysers.',
    iconUrl: '📺',
    isFixedPrice: false,
    basePrice: 500,
    services: [
      {
        name: 'Refrigerator Cooling & Gas Refill',
        description: 'Compressor relay check, defrost timer fix, condenser coil flushing, and refrigerant charge.',
        isFixedPrice: false,
        basePrice: 1200,
        durationMin: 60,
      },
      {
        name: 'Washing Machine Drum & Motor Repair',
        description: 'Top/front load spin cycle fix, drain pump replacement, suspension damper check, and belt change.',
        isFixedPrice: false,
        basePrice: 950,
        durationMin: 60,
      },
      {
        name: 'Microwave Oven Magnetron & Fuse Repair',
        description: 'High voltage diode test, magnetron replacement, turntable motor fix, and door interlock repair.',
        isFixedPrice: false,
        basePrice: 700,
        durationMin: 45,
      },
      {
        name: 'Water Geyser & Heating Element Replacement',
        description: 'Thermostat sensor replacement, magnesium anode descaling, and safety relief valve setup.',
        isFixedPrice: true,
        basePrice: 600,
        durationMin: 45,
      },
    ],
  },
  {
    name: 'Deep Home Cleaning',
    slug: 'deep-home-cleaning',
    description: 'Industrial floor scrubbing, kitchen degreasing, bathroom scaling, and sofa shampoo.',
    iconUrl: '🧹',
    isFixedPrice: true,
    basePrice: 1500,
    services: [
      {
        name: 'Full Home Deep Disinfection (Per Sqft)',
        description: 'High-speed rotary machine floor polishing, tile grout whitening, and eco-friendly antimicrobial fogging.',
        isFixedPrice: true,
        basePrice: 2200,
        durationMin: 180,
      },
      {
        name: 'Sofa & Carpet Foam Shampoo Wash',
        description: 'Deep fabric extraction vacuuming, stain-lifting active foam wash, and dust-mite deodorizer.',
        isFixedPrice: true,
        basePrice: 850,
        durationMin: 60,
      },
      {
        name: 'Overhead & Underground Water Tank Cleaning',
        description: 'Sludge suctioning, high-pressure rotatory jet washing, and chlorine sterilization.',
        isFixedPrice: true,
        basePrice: 1500,
        durationMin: 90,
      },
      {
        name: 'Kitchen Chimney & Exhaust Degreasing',
        description: 'Baffle filter chemical soak, internal blower wheel grease removal, and motor casing wipe.',
        isFixedPrice: true,
        basePrice: 800,
        durationMin: 60,
      },
    ],
  },
  {
    name: 'Painting & Renovation',
    slug: 'painting-renovation',
    description: 'Interior wall painting, damp waterproofing, weather-coat, and drywall putty finishes.',
    iconUrl: '🎨',
    isFixedPrice: false,
    basePrice: 2500,
    services: [
      {
        name: 'Interior Wall Painting & Putty Touch-Up',
        description: 'Wall sanding, 2 coats primer + luxury silk emulsion paint with edge masking tape.',
        isFixedPrice: false,
        basePrice: 3500,
        durationMin: 240,
      },
      {
        name: 'Rooftop Damp & Waterproofing Sealer',
        description: 'Polymer elastomeric membrane coating, crack sealing, and UV reflective heat-reduction finish.',
        isFixedPrice: false,
        basePrice: 4500,
        durationMin: 180,
      },
      {
        name: 'Door & Furniture Enamel Polish',
        description: 'High-gloss lacquer wood polishing, spray polyurethane coat, and scratch elimination.',
        isFixedPrice: false,
        basePrice: 1800,
        durationMin: 120,
      },
    ],
  },
  {
    name: 'CCTV & Smart Security',
    slug: 'cctv-smart-security',
    description: 'IP camera setup, NVR/DVR configuration, remote mobile view, and access control locks.',
    iconUrl: '📹',
    isFixedPrice: false,
    basePrice: 600,
    services: [
      {
        name: 'CCTV Camera Installation & Cable Routing',
        description: 'Cat6/Coaxial cable laying, camera angle positioning, waterproof junction box fitting.',
        isFixedPrice: true,
        basePrice: 600,
        durationMin: 45,
      },
      {
        name: 'NVR/DVR Remote Mobile Setup & Hard Disk Fix',
        description: 'Static IP port forwarding, cloud app pairing, motion detection zones, and HDD SMART diagnostics.',
        isFixedPrice: true,
        basePrice: 500,
        durationMin: 35,
      },
      {
        name: 'Smart Biometric / Fingerprint Door Lock Setup',
        description: 'Mortise lock mortising, keypad calibration, RFID card encoding, and battery backup setup.',
        isFixedPrice: true,
        basePrice: 1200,
        durationMin: 70,
      },
    ],
  },
  {
    name: 'Woodwork & Carpentry',
    slug: 'woodwork-carpentry',
    description: 'Door lock replacement, hinge alignment, kitchen cabinet fixing, and custom furniture.',
    iconUrl: '🪚',
    isFixedPrice: false,
    basePrice: 400,
    services: [
      {
        name: 'Door Lock / Handle & Hydraulic Closer Setup',
        description: 'Deadbolt mortise installation, striker plate alignment, and smooth hydraulic soft-closer.',
        isFixedPrice: true,
        basePrice: 450,
        durationMin: 35,
      },
      {
        name: 'Kitchen Cabinet Hinge & Drawer Channel Repair',
        description: 'Telescopic soft-close runner installation, sagging hinge realignment, and new knob fitting.',
        isFixedPrice: true,
        basePrice: 400,
        durationMin: 30,
      },
      {
        name: 'Bed / Wardrobe Assembly & Structural Repair',
        description: 'Headboard reinforcement, wooden slat leveling, dowel pin gluing, and hardware tightening.',
        isFixedPrice: false,
        basePrice: 750,
        durationMin: 60,
      },
    ],
  },
];

async function main() {
  console.log('🌱 Starting Database Seeding...');

  for (const catData of SEED_DATA) {
    const { services, ...catFields } = catData;

    const category = await prisma.serviceCategory.upsert({
      where: { name: catFields.name },
      update: {
        slug: catFields.slug,
        description: catFields.description,
        iconUrl: catFields.iconUrl,
        isFixedPrice: catFields.isFixedPrice,
        basePrice: catFields.basePrice,
        isActive: true,
        isDeleted: false,
      },
      create: {
        name: catFields.name,
        slug: catFields.slug,
        description: catFields.description,
        iconUrl: catFields.iconUrl,
        isFixedPrice: catFields.isFixedPrice,
        basePrice: catFields.basePrice,
        isActive: true,
        isDeleted: false,
      },
    });

    console.log(`✅ Category seeded: ${category.name} (${category.id})`);

    for (const serviceData of services) {
      const existing = await prisma.service.findFirst({
        where: {
          categoryId: category.id,
          name: serviceData.name,
        },
      });

      if (existing) {
        await prisma.service.update({
          where: { id: existing.id },
          data: {
            description: serviceData.description,
            isFixedPrice: serviceData.isFixedPrice,
            basePrice: serviceData.basePrice,
            durationMin: serviceData.durationMin,
            isActive: true,
            isDeleted: false,
          },
        });
      } else {
        await prisma.service.create({
          data: {
            categoryId: category.id,
            name: serviceData.name,
            description: serviceData.description,
            isFixedPrice: serviceData.isFixedPrice,
            basePrice: serviceData.basePrice,
            durationMin: serviceData.durationMin,
            isActive: true,
            isDeleted: false,
          },
        });
      }
    }
  }

  const allCategories = await prisma.serviceCategory.count();
  const allServices = await prisma.service.count();

  console.log(`🎉 Seeding completed! Total Categories: ${allCategories}, Total Services: ${allServices}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
