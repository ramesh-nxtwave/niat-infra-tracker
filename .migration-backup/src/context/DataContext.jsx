import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';
import { logAuditAction } from '../utils/auditLogger';

const DataContext = createContext();
export const useData = () => useContext(DataContext);

const ITEM_STATUSES = ['Done', 'In-Progress', 'Yet to start', 'Need to revamp', 'No info as of now', 'Blocker'];

const generateMockChecklist = (items) => {
  return items.map(item => ({
    id: Math.random().toString(36).substr(2, 9),
    name: item.name,
    category: item.category,
    spec: item.spec || '',
    requiresCapacity: item.requiresCapacity || false,
    status: 'Yet to start',
    remarks: '',
    capacity: '',
    photoLink: '',
    assignee: '',
    targetDate: '',
    actualDate: '',
    lastUpdated: new Date().toISOString()
  }));
};

const MODEL_CLASSROOM_ITEMS = [
  { category: '🧹 CIVIL & FINISHING', name: 'Flooring' },
  { category: '🧹 CIVIL & FINISHING', name: 'Painting / Wall Finishing' },
  { category: '🧹 CIVIL & FINISHING', name: 'Ceiling / False Ceiling' },
  { category: '🧹 CIVIL & FINISHING', name: 'Roller Blinds' },
  { category: '🧹 CIVIL & FINISHING', name: 'Electrical Wiring – Concealed & Safe' },
  { category: '🧹 CIVIL & FINISHING', name: 'TV wall' },
  { category: '❄️ ELECTRICAL & HVAC', name: 'AC Installation' },
  { category: '❄️ ELECTRICAL & HVAC', name: 'AC Working Condition' },
  { category: '❄️ ELECTRICAL & HVAC', name: 'Lights Working Condition' },
  { category: '❄️ ELECTRICAL & HVAC', name: 'UPS Power Connection' },
  { category: '❄️ ELECTRICAL & HVAC', name: 'Power Sockets / Outlets' },
  { category: '❄️ ELECTRICAL & HVAC', name: 'Transformer & MCB Panels', requiresCapacity: true },
  { category: '❄️ ELECTRICAL & HVAC', name: 'Generator capacity', requiresCapacity: true },
  { category: '🪑 FURNITURE & SEATING', name: 'Bench with Seater' },
  { category: '🪑 FURNITURE & SEATING', name: 'Bench Charging Points' },
  { category: '🌐 TV, AV & WIFI', name: 'Internet & Access Points Installation' },
  { category: '🌐 TV, AV & WIFI', name: 'Network Configuration and Testing' },
  { category: '🌐 TV, AV & WIFI', name: 'TV - Working' },
  { category: '🌐 TV, AV & WIFI', name: 'Audio - Speaker, Amplifier, Mixer, Mic' },
  { category: '🌐 TV, AV & WIFI', name: 'AV - Working Condition' },
  { category: '🌐 TV, AV & WIFI', name: 'Audio Tuning & Testing' },
  { category: '🌐 TV, AV & WIFI', name: 'HDMI Connectivity' },
  { category: '🔒 SECURITY & SURVEILLANCE', name: 'CCTV Installation' },
  { category: '🔒 SECURITY & SURVEILLANCE', name: 'CCTV Working Condition' },
  { category: '🔒 SECURITY & SURVEILLANCE', name: 'Door Lock / Access Control' }
];

const OVERALL_CLASSROOM_ITEMS = [...MODEL_CLASSROOM_ITEMS];

const LAB_5_ITEMS = [
  { category: 'Furniture', name: '3D Printing Table / Assembly Table', spec: 'Heavy-duty 150×60×75 cm metal-leg table' },
  { category: 'Furniture', name: 'Material Store Rack (Metal Rack)', spec: '5-Tier Metal Storage Shelf – 63"H × 24"W × 12"D' },
  { category: 'Lighting', name: 'Ambient Ceiling Light – Round Panel', spec: '4000K neutral white – circular pendant' },
  { category: 'HVAC', name: 'Air Conditioning (Cassette Type)', spec: '1.5-ton cassette AC' },
  { category: 'Electrical', name: 'Power Sockets & Charging Points', spec: 'Integrated sockets and USB ports at workstations' },
  { category: 'UPS / Power Backup', name: 'UPS Power Backup', spec: 'Min 5 KVA for lab equipment' },
  { category: 'Security', name: 'CCTV Cameras', spec: 'Safety, discipline, and monitored learning' },
  { category: 'Connectivity', name: 'Wi-Fi Access Points', spec: 'Aruba AP-515 / AP-505 Wi-Fi 6' }
];

const STAFF_ROOM_ITEMS = [
  { category: 'Space', name: 'Staffroom Area – General Seating' },
  { category: 'Space', name: 'Head Cabin' },
  { category: 'Space', name: 'Meeting Cabin' },
  { category: 'Storage', name: 'Storage Area' },
  { category: 'Electrical', name: 'Adequate Lighting' },
  { category: 'Electrical', name: 'Power Sockets' },
  { category: 'HVAC', name: 'Air Conditioning (AC)' },
  { category: 'Civil', name: 'Natural Ventilation' },
  { category: 'Connectivity', name: 'Wi-Fi Access' },
  { category: 'Security', name: 'CCTV (optional)' },
  { category: 'Furniture', name: 'Ergonomic Chairs' },
  { category: 'Furniture', name: 'Work Tables' },
  { category: 'Furniture', name: 'Storage Racks' }
];

  const normalizeUniversity = (uni) => {
    if (!uni) return null;

    // 1. Handle Legacy JSONB Trackers
    let rawTrackers = uni.trackers || {};
    if (typeof rawTrackers === 'string') {
      try { rawTrackers = JSON.parse(rawTrackers); } catch (e) { rawTrackers = {}; }
    }

    const getLegacyItems = (tracker) => {
      if (!tracker) return [];
      if (Array.isArray(tracker)) return tracker;
      if (Array.isArray(tracker.items)) return tracker.items;
      return [];
    };

    // 2. Optimized Relational Mapping using Maps
    const spaces = uni.spaces || [];
    const spacesMap = new Map();
    spaces.forEach(s => {
      if (s.id) spacesMap.set(String(s.id), s);
      if (s.space_type) {
        const typeKey = s.space_type.toLowerCase();
        if (!spacesMap.has(typeKey)) spacesMap.set(typeKey, s);
      }
      if (s.name) {
        const nameKey = s.name.toLowerCase();
        if (!spacesMap.has(nameKey)) spacesMap.set(nameKey, s);
      }
    });

    const mapRelationalItems = (spaceKey) => {
      const space = spacesMap.get(String(spaceKey).toLowerCase());
      if (!space || !Array.isArray(space.space_checklist_status)) return null;

      return space.space_checklist_status.map(update => ({
        id: update.id,
        isRelational: true,
        checklist_item_id: update.checklist_item_id,
        name: update.checklist_items?.name || 'Unknown Item',
        category: update.checklist_items?.category || 'General',
        spec: update.checklist_items?.specification || '',
        requiresCapacity: update.checklist_items?.name?.toLowerCase().includes('generator') || update.checklist_items?.name?.toLowerCase().includes('transformer'),
        status: (update.meta?.is_blocker === true) ? 'Blocker' : (update.current_status || 'Yet to start'),
        remarks: (update.remarks === update.photo_url || update.remarks === update.meta?.photo_url || (update.photo_history?.[0]?.photo_url === update.remarks)) 
          ? '' 
          : (update.remarks || ''),
        capacity: update.capacity || '',
        photoLink: update.photo_history?.[0]?.photo_url || update.meta?.photo_url || update.photo_url || '',
        vendorRequired: update.vendor_required || 'no',
        vendorSuggestion: update.vendor_suggestion || '',
        universityTimeline: update.university_timeline || '',
        targetDate: update.target_timeline || '',
        actualDate: update.actual_completion_date || '',
        assignee: update.meta?.university_poc || update.university_poc_name || '',
        lastUpdated: update.updated_at || new Date().toISOString(),
        university_uuid: update.university_uuid,
        space_id: update.space_id,
        checklist_item_id: update.checklist_item_id,
        meta: update.meta || {}
      }));
    };

    const modelItems = mapRelationalItems('model_classroom') || getLegacyItems(rawTrackers.modelClassroom);
    const labItems = mapRelationalItems('lab') || getLegacyItems(rawTrackers.lab5);
    const staffItems = mapRelationalItems('staff_room') || getLegacyItems(rawTrackers.staffRoom);

    const classroomsWithChecklists = (uni.university_classrooms || []).map(room => {
      if (!room) return { name: 'Unknown' };
      const space = spacesMap.get(room.room_id?.toLowerCase());
      return {
        ...room,
        id: room.classroom_uuid || room.id,
        items: space ? (mapRelationalItems(space.id) || []) : []
      };
    });

    const getReadiness = (items) => {
      if (!items || items.length === 0) return 0;
      const done = items.filter(i => i.status === 'Done').length;
      return Math.round((done / items.length) * 100);
    };

    const allItems = [...modelItems, ...labItems, ...staffItems, ...classroomsWithChecklists.flatMap(c => c.items || [])];
    const overallReadiness = allItems.length === 0 ? 0 : Math.round((allItems.filter(i => i.status === 'Done').length / allItems.length) * 100);

    return {
      ...uni,
      id: uni.id,
      code: uni.code || uni.id,
      name: uni.name,
      location: uni.location || 'TBD',
      pocName: uni.poc_name || '',
      pocNumber: uni.poc_phone || '',
      targetDate: uni.target_date || '',
      startDate: uni.start_date || '',
      zone_id: uni.zone_id || null,
      zoneName: uni.zones?.name || '',
      apmName: uni.apm_name || '',
      numClassrooms: uni.num_classrooms || null,
      classroomCapacity: uni.classroom_capacity || null,
      classroomAllocationDone: uni.classroom_allocation_done || false,
      lastUpdated: uni.last_updated || uni.updated_at || '',
      isLightData: !uni.spaces || uni.spaces.some(s => !s.space_checklist_status || s.space_checklist_status.length === 0),
      overallReadiness,
      spaceMetrics: {
        'Model Classroom': getReadiness(modelItems),
        'Overall Classroom': getReadiness(classroomsWithChecklists.flatMap(c => c.items || [])),
        '5.0 Lab': getReadiness(labItems),
        'Staff Room': getReadiness(staffItems),
      },
      riskStatus: uni.risk_status || 'GREEN',
      trackers: {
        modelClassroom: { items: modelItems, categoryVendors: rawTrackers.modelClassroom?.categoryVendors || {} },
        lab5: { items: labItems, categoryVendors: rawTrackers.lab5?.categoryVendors || {} },
        staffRoom: { items: staffItems, categoryVendors: rawTrackers.staffRoom?.categoryVendors || {} },
        overallClassroom: { classrooms: classroomsWithChecklists, categoryVendors: rawTrackers.overallClassroom?.categoryVendors || {} }
      }
    };
  };

export const DataProvider = ({ children }) => {
  const [universities, setUniversities] = useState([]);   
  const [universityDetails, setUniversityDetails] = useState({}); 
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pendingFetches = useRef(new Map());

  // ── STAGE 1: Lightweight Initial Fetch ─────────────────────────────────────
  useEffect(() => {
    const fetchUniversities = async () => {
      try {
        if (!supabase) throw new Error('Supabase client not initialized');

        // Fetch essential metrics ONLY to keep initial load < 1s
        const { data, error: sbError } = await supabase
          .from('universities')
          .select(`
            *,
            spaces(id, space_type, name),
            university_classrooms(room_id, classroom_uuid, floor, capacity)
          `)
          .order('name');

        if (sbError) throw sbError;

        const normalizedData = (data || []).map(normalizeUniversity);
        setUniversities(normalizedData);
      } catch (err) {
        console.error('Fetch error:', err);
        setError(err.message || 'Failed to connect to database');
      } finally {
        setLoading(false);
      }
    };
    fetchUniversities();
  }, []);

  // ── STAGE 2: Lazy deep fetch ──────────────────────────────────────────────
  const loadUniversityDetail = React.useCallback(async (id, force = false) => {
    const key = String(id);
    if (universityDetails[key] && !force && !universityDetails[key].isLightData) return;
    
    // Prevent redundant parallel fetches for the same ID
    if (pendingFetches.current.has(key) && !force) return pendingFetches.current.get(key);

    const fetchPromise = (async () => {
      try {
        console.log(`⏱️ Loading deep details for ${key}...`);
        
        // Timeout handling: 15 seconds max
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Checklist fetch timed out (15s). Please check your connection.')), 15000)
        );

        const queryPromise = supabase
          .from('universities')
          .select(`
            *,
            spaces (
              id, name, space_type,
              space_checklist_status (
                id, university_uuid, space_id, current_status, photo_url, remarks,
                vendor_required, vendor_suggestion,
                university_timeline, target_timeline, actual_completion_date, 
                meta, updated_at, university_poc_name,
                checklist_item_id,
                checklist_items (id, name, category, specification),
                photo_history (id, photo_url, uploaded_by, uploaded_at)
              )
            ),
            university_classrooms (room_id, classroom_uuid, floor, capacity, timeline, drive_link, poc_name, poc_number, remarks)
          `)
          .eq('id', id)
          .single();

        const { data: fullUni, error: fetchErr } = await Promise.race([queryPromise, timeoutPromise]);
        
        if (fetchErr) throw fetchErr;
        
        const normalized = normalizeUniversity(fullUni);
        setUniversityDetails(prev => ({ ...prev, [key]: normalized }));
        setUniversities(prev => prev.map(u => String(u.id) === String(id) ? normalized : u));
        
        console.log(`✅ Deep details loaded for ${key}`);
        return normalized;
      } catch (err) {
        console.error(`❌ Deep fetch error for ${key}:`, err);
        throw err;
      } finally {
        pendingFetches.current.delete(key);
      }
    })();

    pendingFetches.current.set(key, fetchPromise);
    return fetchPromise;
  }, [universityDetails]);

  const addUniversity = async (newUniDetails) => {
    const getMaxId = () => {
      if (universities.length === 0) return 0;
      const ids = universities.map(u => parseInt(u.id) || 0);
      const codeNumbers = universities.map(u => {
        const match = String(u.code || '').match(/UNI-(\d+)/);
        return match ? parseInt(match[1]) : 0;
      });
      const validCodes = codeNumbers.filter(n => !isNaN(n));
      return Math.max(0, ...ids, ...validCodes);
    };
    const nextId = getMaxId() + 1;

    // 1. Create University Record
    try {
      if (!supabase) return;
      const code = `UNI-${nextId.toString().padStart(3, '0')}`;
      const { data, error } = await supabase.from('universities').insert([{
        id: code,
        name: newUniDetails.name,
        code: code,
        poc_name: newUniDetails.pocName,
        poc_phone: newUniDetails.pocNumber,
        target_date: newUniDetails.targetDate,
        zone_id: newUniDetails.zone_id ? parseInt(newUniDetails.zone_id, 10) : null,
        apm_name: newUniDetails.apm_name
      }]).select();

      if (error) {
        console.error('❌ Insert University Error:', error.message, error.details);
        throw error;
      }

      const uni = data[0];

      await logAuditAction({
        action: 'CREATE',
        module: 'Universities',
        entityId: code,
        updatedValue: newUniDetails
      });

      // 2. Seed Spaces
      const spacesToCreate = [
        { name: 'Model Classroom', space_type: 'classroom', university_uuid: uni.uuid_id },
        { name: 'Lab 5.0', space_type: 'lab', university_uuid: uni.uuid_id },
        { name: 'Staff Room', space_type: 'staff_room', university_uuid: uni.uuid_id }
      ];

      const { data: createdSpaces, error: spaceError } = await supabase.from('spaces').insert(spacesToCreate).select();
      if (spaceError) throw spaceError;

      // 3. Fetch Checklist Items for Seeding
      const { data: allChecklistItems } = await supabase.from('checklist_items').select('*');

      if (allChecklistItems && (createdSpaces || []).length > 0) {
        const updatesToInsert = [];
        const spacesToUse = createdSpaces || [];

        spacesToUse.forEach(space => {
          const moduleName = space.space_type === 'classroom' ? 'model_classroom' :
            space.space_type === 'lab' ? 'lab' : 'staff_room';

          const moduleItems = allChecklistItems.filter(item => item.module === moduleName);
          moduleItems.forEach(item => {
            updatesToInsert.push({
              space_id: space.id,
              checklist_item_id: item.id,
              university_uuid: uni.uuid_id,
              current_status: 'Yet to start'
            });
          });
        });

        if (updatesToInsert.length > 0) {
          // Use insert instead of upsert since these are brand new spaces
          await supabase.from('space_checklist_status').insert(updatesToInsert);
        }
      }

      // Final sync from DB to get full relational structure
      const { data: fullUni } = await supabase.from('universities').select('*, spaces(*, space_checklist_status(*, checklist_items(*)))').eq('id', code).single();
      setUniversities(prev => prev.map(u => (u.id === code || u.id === nextId) ? normalizeUniversity(fullUni) : u));
    } catch (err) { console.error("Insert error:", err); }
  };

  const updateUniversity = async (id, trackerName, updatedTrackerData, itemIndex) => {
    const key = String(id);
    // 1. Update detail cache (source of truth for open university)
    setUniversityDetails(prev => {
      const existing = prev[key];
      if (!existing) return prev;
      const newUni = { ...existing, trackers: { ...existing.trackers, [trackerName]: updatedTrackerData } };
      const allItems = [
        ...(newUni.trackers.modelClassroom?.items || []),
        ...(newUni.trackers.lab5?.items || []),
        ...(newUni.trackers.staffRoom?.items || []),
        ...(newUni.trackers.overallClassroom?.items || []),
      ];
      if (allItems.length > 0)
        newUni.overallReadiness = Math.round((allItems.filter(i => i.status === 'Done').length / allItems.length) * 100);
      return { ...prev, [key]: newUni };
    });
    // 2. Also update the light list so dashboard cards stay in sync
    setUniversities(prev => prev.map(uni => {
      if (String(uni.id) !== key) return uni;
      const detail = universityDetails[key];
      const newTrackers = { ...(detail?.trackers || uni.trackers), [trackerName]: updatedTrackerData };
      const allItems = [
        ...(newTrackers.modelClassroom?.items || []),
        ...(newTrackers.lab5?.items || []),
        ...(newTrackers.staffRoom?.items || []),
        ...(newTrackers.overallClassroom?.items || []),
      ];
      const overallReadiness = allItems.length > 0
        ? Math.round((allItems.filter(i => i.status === 'Done').length / allItems.length) * 100)
        : uni.overallReadiness;
      return { ...uni, overallReadiness };
    }));

    // 2. Persistance
    try {
      if (!supabase) return;

      const uni = getUniversity(id);

      // A. Relational Updates
      let relationalUpdates = [];
      const isRealId = (item) => {
        if (item.isRelational) return true;
        if (!item.id) return false;
        const sId = String(item.id);
        return sId.length > 20 || (!isNaN(item.id) && sId.length > 0);
      };

      if (updatedTrackerData.items) {
        relationalUpdates = updatedTrackerData.items.filter(isRealId);
      } else if (updatedTrackerData.classrooms) {
        relationalUpdates = updatedTrackerData.classrooms.flatMap(c => c.items || []).filter(isRealId);
      }

      // B. If no IDs found but we know the module, try to find the space and update
      if (relationalUpdates.length === 0 && updatedTrackerData.items && uni) {
        // Normalise trackerName for matching
        const searchTerms = [
          trackerName.toLowerCase(),
          trackerName.replace(/([A-Z])/g, '_$1').toLowerCase(), // camel to snake
          trackerName.replace(/([A-Z])/g, ' $1').toLowerCase()  // camel to spaces
        ];
        
        // Handle specific shorthand/special cases
        if (trackerName === 'modelClassroom') searchTerms.push('model');
        if (trackerName === 'lab5') searchTerms.push('lab');
        if (trackerName === 'staffRoom') searchTerms.push('staff');
        if (trackerName === 'overallClassroom') searchTerms.push('overall');

        const space = (uni.spaces || []).find(s => {
          const sType = (s.space_type || '').toLowerCase();
          const sName = (s.name || '').toLowerCase();
          return searchTerms.some(term => 
            sType === term || 
            sName.includes(term) || 
            term.includes(sType)
          );
        });
        
        if (space && space.space_checklist_status) {
           console.log(`🔍 Mapping items for space: ${space.name} (${space.id})`);
           // Map the UI items back to the DB items by name
           relationalUpdates = updatedTrackerData.items.map(uiItem => {
             const dbItem = space.space_checklist_status.find(ds => 
               ds.checklist_items?.name?.toLowerCase().trim() === uiItem.name?.toLowerCase().trim()
             );
             if (dbItem) return { ...uiItem, id: dbItem.id };
             return null;
           }).filter(Boolean);
        }
      }

      if (relationalUpdates.length === 0 && updatedTrackerData.items) {
        console.warn('⚠️ No database IDs found for items in', trackerName);
        throw new Error(`Database mapping missing for ${trackerName}. Please contact support.`);
      }

      if (relationalUpdates.length > 0) {
        console.log(`🚀 Persisting ${relationalUpdates.length} updates for ${trackerName} (University: ${id})`);
        
        // Bulk upsert is much faster than individual updates
        const payloads = relationalUpdates.map(item => ({
          id: item.id,
          university_uuid: item.university_uuid || uni?.uuid_id,
          space_id: item.space_id,
          checklist_item_id: item.checklist_item_id,
          current_status: item.status === 'Blocker' ? 'Need to revamp' : item.status,
          photo_url: item.photoLink || null,
          remarks: item.photoLink || item.remarks || null,
          vendor_required: item.vendorRequired || 'no',
          vendor_suggestion: item.vendorSuggestion || null,
          university_timeline: item.universityTimeline || null,
          target_timeline: item.targetDate || null,
          actual_completion_date: item.actualDate || null,
          university_poc_name: item.assignee,
          meta: { 
            ...item.meta, 
            university_poc: item.assignee, 
            is_blocker: item.status === 'Blocker',
            photo_url: item.photoLink 
          }
        }));

        const { error: upsertError } = await supabase
          .from('space_checklist_status')
          .upsert(payloads);

        if (upsertError) {
          console.error('❌ Supabase Upsert Error:', upsertError);
          throw new Error(`Database update failed: ${upsertError.message}`);
        }
        console.log('✅ Supabase updates synced successfully');
      }
      
      // Update the university's master 'last_updated' timestamp in the DB
      const now = new Date().toISOString();
      await supabase.from('universities').update({ last_updated: now }).eq('id', id);
      
      // Update local state so the Master Tracker refreshes immediately
      setUniversities(prev => prev.map(u => String(u.id) === String(id) ? { 
        ...u, 
        last_updated: now, 
        lastUpdated: now, // Add this to match MasterTracker's expectation
        last_updated_at: now 
      } : u));

      await logAuditAction({
        action: 'UPDATE',
        module: 'UniversityData',
        entityId: id,
        updatedValue: { tracker: trackerName, data: updatedTrackerData }
      });

      // B. JSONB Trackers Sync removed to prevent data duplication. 
      // The relational 'status_updates' table is now the single source of truth.

    } catch (err) { 
      console.error("Update error:", err); 
      throw err;
    }
  };

  const deleteUniversity = async (id) => {
    // Note: Confirmation is now handled at the UI component level (UniversityDetail.jsx / UniversityList.jsx)
    // using the custom ConfirmProvider, so we can directly proceed with deletion here.
    setUniversities(prev => prev.filter(uni => uni.id !== id));
    try {
      if (!supabase) return;
      await supabase.from('universities').delete().eq('id', id);
      
      await logAuditAction({
        action: 'DELETE',
        module: 'Universities',
        entityId: id
      });
    } catch (err) { console.error("Delete error:", err); }
  };

  // ── UPDATE UNIVERSITY METADATA ───────────────────────────────────────────
  const updateUniversityMetadata = async (id, payload) => {
    try {
      if (!supabase) return;

      // Update DB
      const { error } = await supabase.from('universities').update(payload).eq('id', id);
      if (error) throw error;

      // Update local states - map snake_case payload back to camelCase for the UI
      const normalizedPayload = {
        ...payload,
        pocName: payload.poc_name,
        pocNumber: payload.poc_phone,
        apmName: payload.apm_name,
        numClassrooms: payload.num_classrooms,
        classroomCapacity: payload.classroom_capacity,
        classroomAllocationDone: payload.classroom_allocation_done,
        startDate: payload.start_date,
        targetDate: payload.target_date
      };


      const updateState = (prev) => prev.map(u => {
        const matchesId = String(u.id).toLowerCase() === String(id).toLowerCase();
        const matchesUuid = u.uuid_id && String(u.uuid_id).toLowerCase() === String(id).toLowerCase();
        return (matchesId || matchesUuid) ? { ...u, ...normalizedPayload } : u;
      });

      setUniversities(updateState);
      setUniversityDetails(prev => {
        const existingKeys = Object.keys(prev);
        const matchingKey = existingKeys.find(k => 
          k.toLowerCase() === String(id).toLowerCase()
        ) || String(id);
        
        if (!prev[matchingKey]) return prev;
        return { ...prev, [matchingKey]: { ...prev[matchingKey], ...normalizedPayload } };
      });

      await logAuditAction({
        action: 'UPDATE_METADATA',
        module: 'Universities',
        entityId: id,
        updatedValue: payload
      });

      return true;
    } catch (err) {
      console.error("Metadata update error:", err);
      throw err;
    }
  };

  const updateUniversityZone = async (id, zoneId) => {
    try {
      if (!supabase) return;
      const zoneNum = zoneId ? parseInt(zoneId, 10) : null;
      
      const { error } = await supabase
        .from('universities')
        .update({ zone_id: zoneNum })
        .eq('id', id);
      
      if (error) throw error;
      
      // Update local state
      setUniversities(prev => prev.map(u => 
        String(u.id) === String(id) ? { ...u, zone_id: zoneNum } : u
      ));
      
      setUniversityDetails(prev => {
        const key = String(id);
        if (!prev[key]) return prev;
        return { ...prev, [key]: { ...prev[key], zone_id: zoneNum } };
      });

      await logAuditAction({
        action: 'UPDATE_ZONE',
        module: 'Universities',
        entityId: id,
        updatedValue: { zone_id: zoneNum }
      });
      
      return true;
    } catch (err) {
      console.error("Zone update error:", err);
      return false;
    }
  };

  // ── MANAGE DYNAMIC CLASSROOMS ─────────────────────────────────────────────
  const saveClassroom = async (classroomData) => {
    try {
      if (!supabase) return;
      const isNew = !classroomData.id;
      const payload = { ...classroomData };
      if (isNew) delete payload.id; // DB will gen uuid

      if (payload.capacity === '') payload.capacity = null;
      else if (payload.capacity != null) payload.capacity = parseInt(payload.capacity, 10) || null;

      if (payload.timeline === '') payload.timeline = null;

      let savedRecord;
      if (isNew) {
        const { data, error } = await supabase.from('university_classrooms').insert([payload]).select().single();
        if (error) throw error;
        savedRecord = data;
      } else {
        const { data, error } = await supabase.from('university_classrooms').update(payload).eq('classroom_uuid', classroomData.id).select().single();
        if (error) throw error;
        savedRecord = data;
      }

      // Update local cache
      const key = String(classroomData.university_id);

      // 3. Ensure corresponding Space exists for checklist (for Overall Classroom module)
      if (isNew) {
        const uni = universityDetails[key] ||
          universities.find(u => String(u.id) === key || String(u.code) === key || String(u.uuid_id) === key);
        // Create a space for this classroom to hold its checklist
        const { data: spaceData, error: spaceError } = await supabase.from('spaces').insert([{
          university_uuid: uni?.uuid_id,
          name: savedRecord.room_id,
          space_type: 'classroom',
          floor: savedRecord.floor,
          capacity: savedRecord.capacity ? parseInt(savedRecord.capacity, 10) : null
        }]).select().single();

        await logAuditAction({
          action: 'CREATE_ROOM',
          module: 'Universities',
          entityId: savedRecord.classroom_uuid || savedRecord.id,
          updatedValue: savedRecord
        });

        if (spaceError) {
          console.error('❌ Spaces Insert Error:', spaceError);
        }

        if (!spaceError && spaceData) {
          const spaceId = spaceData.id;
          // Seed checklist items for 'overall_classroom' module
          const { data: items } = await supabase.from('checklist_items').select('id').eq('module', 'overall_classroom');
          if (items && items.length > 0) {
            const seedUpdates = items.map(item => ({
              space_id: spaceId,
              checklist_item_id: item.id,
              university_uuid: uni?.uuid_id,
              current_status: 'Yet to start'
            }));
            await supabase.from('space_checklist_status').insert(seedUpdates);
          }
        }
      }

      // Re-fetch full university data to ensure all relational links (spaces, items) are correctly established
      const { data: fullUni, error: fetchErr } = await supabase
        .from('universities')
        .select(`
          *,
          spaces (
            id, name, space_type,
            space_checklist_status (
              id, current_status, remarks,
              vendor_required, vendor_suggestion,
              university_timeline, target_timeline, actual_completion_date, 
              meta, updated_at,
              checklist_item_id,
              checklist_items (id, name, category, specification),
              photo_history (id, photo_url, uploaded_by, uploaded_at)
            )
          ),
          university_classrooms (*)
        `)
        .eq('id', classroomData.university_id)
        .single();

      if (!fetchErr && fullUni) {
        const normalized = normalizeUniversity(fullUni);
        setUniversityDetails(prev => ({ ...prev, [key]: normalized }));
        setUniversities(prev => prev.map(u => String(u.id) === key ? normalized : u));
      }

      // Return the saved record with 'id' mapped for the UI
      return {
        ...savedRecord,
        id: savedRecord.classroom_uuid || savedRecord.id
      };
    } catch (err) {
      console.error("Classroom save error:", err);
      throw err;
    }
  };

  const deleteClassroom = async (classroomId, universityId) => {
    try {
      if (!supabase) return;

      // Get the classroom details first to find the space
      const { data: classroom } = await supabase.from('university_classrooms').select('room_id').eq('classroom_uuid', classroomId).single();

      // 1. Delete classroom registry
      const { error } = await supabase.from('university_classrooms').delete().eq('classroom_uuid', classroomId);
      if (error) throw error;

      // 2. Delete corresponding space (which will cascade delete status_updates)
      if (classroom) {
        // Find the university to get its uuid_id for safe deletion
        const uni = universityDetails[String(universityId)] || universities.find(u => String(u.id) === String(universityId));
        if (uni?.uuid_id) {
          await supabase.from('spaces').delete()
            .eq('name', classroom.room_id)
            .eq('university_uuid', uni.uuid_id);
        } else {
          // Fallback if uuid_id not found
          await supabase.from('spaces').delete()
            .eq('name', classroom.room_id);
        }

        await logAuditAction({
          action: 'DELETE_ROOM',
          module: 'Universities',
          entityId: classroomId
        });
      }

      // 3. Re-fetch full university data
      const key = String(universityId);
      const { data: fullUni, error: fetchErr } = await supabase
        .from('universities')
        .select(`
          *,
          spaces (
            id, name, space_type,
            space_checklist_status (
              id, current_status, remarks,
              vendor_required, vendor_suggestion,
              university_timeline, target_timeline, actual_completion_date, 
              meta, updated_at,
              checklist_item_id,
              checklist_items (id, name, category, specification),
              photo_history (photo_url)
            )
          ),
          university_classrooms (*)
        `)
        .eq('id', universityId)
        .single();

      if (!fetchErr && fullUni) {
        const normalized = normalizeUniversity(fullUni);
        setUniversityDetails(prev => ({ ...prev, [key]: normalized }));
        setUniversities(prev => prev.map(u => String(u.id) === key ? normalized : u));
      }
    } catch (err) {
      console.error("Classroom delete error:", err);
      throw err;
    }
  };

  const getUniversity = (id) => {
    if (!id) return null;
    const key = String(id).toLowerCase();
    // 1. Check detail cache (case-insensitive key)
    const detailKey = Object.keys(universityDetails).find(k => k.toLowerCase() === key);
    if (detailKey) return universityDetails[detailKey];
    
    // 2. Check light list
    return (universities || []).find(u => 
      String(u.id).toLowerCase() === key || 
      (u.uuid_id && String(u.uuid_id).toLowerCase() === key)
    );
  };

  const dashboardStats = React.useMemo(() => {
    const totalUniversities = universities.length;
    const avgReadiness = totalUniversities > 0 ? Math.round(universities.reduce((acc, curr) => acc + (curr.overallReadiness || 0), 0) / totalUniversities) : 0;
    
    const godModeStats = { 
      delayedUniversities: 0, 
      statusBreakdown: { 'Done': 0, 'In-Progress': 0, 'Yet to start': 0, 'Blocked': 0 },
      delayedItems: [], 
      complianceIssues: [] 
    };

    const categoryCompletion = { '🌐 TV, AV & WIFI': { done: 0, total: 0 }, '🛋️ Furniture & Setup': { done: 0, total: 0 }, '⚡ Electrical & UPS': { done: 0, total: 0 }, '💡 Lighting & Ambience': { done: 0, total: 0 } };

    universities.forEach(uni => {
      const trackers = uni.trackers || {};
      [trackers.modelClassroom, trackers.lab5, trackers.staffRoom].forEach(t => {
        if (t && t.items) {
          t.items.forEach(item => { 
            const status = item.status || 'Yet to start';
            godModeStats.statusBreakdown[status] = (godModeStats.statusBreakdown[status] || 0) + 1; 
            
            if (categoryCompletion[item.category]) {
              categoryCompletion[item.category].total++;
              if (status === 'Done') categoryCompletion[item.category].done++;
            }
          });
        }
      });
    });

    const categoryCompletionData = Object.entries(categoryCompletion).map(([name, stats]) => ({
      name,
      percentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
    }));

    // Mock activity data for now, but linked to real totals
    const activityChartData = [
      { name: 'Mon', count: Math.floor(godModeStats.statusBreakdown['Done'] / 5) },
      { name: 'Tue', count: Math.floor(godModeStats.statusBreakdown['Done'] / 4) },
      { name: 'Wed', count: Math.floor(godModeStats.statusBreakdown['Done'] / 3) },
      { name: 'Thu', count: Math.floor(godModeStats.statusBreakdown['Done'] / 2) },
      { name: 'Fri', count: godModeStats.statusBreakdown['Done'] }
    ];

    return { totalUniversities, avgReadiness, godModeStats, categoryCompletionData, activityChartData };
  }, [universities]);

  return (
    <DataContext.Provider value={{
      universities,
      universityDetails,
      loading,
      error,
      getUniversity,
      addUniversity,
      updateUniversity,
      updateUniversityMetadata,
      saveClassroom,
      deleteClassroom,
      deleteUniversity,
      updateUniversityZone,
      dashboardStats,
      loadUniversityDetail
    }}>
      {children}
    </DataContext.Provider>
  );
};
