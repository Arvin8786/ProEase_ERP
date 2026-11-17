import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, 
  FileSpreadsheet, 
  UploadCloud, 
  DownloadCloud, 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  Check, 
  X, 
  Building2, 
  Truck, 
  Package, 
  AlertTriangle,
  RefreshCw,
  FileCheck2,
  Clock,
  ShieldCheck,
  Layers,
  ArrowUpDown,
  CheckSquare,
  Square,
  Ban,
  EyeOff,
  Eye,
  CheckCircle2,
  Sparkles,
  Calendar
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  writeBatch,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { InventoryItem, Vendor, DepartmentMaster, UserProfile } from '../../types';
import { hasPermission } from '../../lib/rbac';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { UserAccessManagement } from './UserAccessManagement';
import { TimedMarkdownSettings } from './TimedMarkdownSettings';
import { isExecutiveRole, getRoleBasedPricing } from '../../lib/sapMovements';
import { 
  isItemPromotionActive, 
  getItemPromotionDetails, 
  normalizeExcelDate 
} from '../../lib/pricingUtils';

interface MasterDataManagementProps {
  profile: UserProfile | null;
}

export const MasterDataManagement: React.FC<MasterDataManagementProps> = ({ profile }) => {
  const [activeTab, setActiveTab] = useState<'materials' | 'vendors' | 'departments' | 'markdown' | 'rbac'>('materials');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const isExecutive = isExecutiveRole(profile);

  // Item Modal State
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [itemForm, setItemForm] = useState({
    sku: '',
    name: '',
    description: '',
    unit: 'PCS',
    currentStock: 0,
    minStock: 5,
    unitPrice: 0,
    cost_price: 0,
    selling_price: 0,
    promotion_price: '' as number | '',
    promoStartDate: '',
    promoEndDate: '',
    isActive: true,
    status: 'active' as 'active' | 'inactive',
    trackingType: 'standard' as 'standard' | 'batch' | 'serial',
    batchNumber: '',
    expiryDate: '',
    serialNumber: '',
    vendorCode: '',
    vendorName: '',
    category: 'General',
  });

  // Vendor Modal State
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [vendorForm, setVendorForm] = useState({
    vendorCode: '',
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    address: '',
    category: 'Supplier',
    paymentTerms: 'Net 30',
  });

  // Department Modal State
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [selectedDept, setSelectedDept] = useState<any | null>(null);
  const [deptForm, setDeptForm] = useState({
    code: '',
    name: '',
    headOfDepartment: '',
    description: '',
  });

  // Delete Confirmation Modal State
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    type: 'item' | 'vendor' | 'dept';
    id: string;
    title: string;
  }>({
    open: false,
    type: 'item',
    id: '',
    title: '',
  });

  // Multi-Sheet Import Preview Modal
  const [importPreview, setImportPreview] = useState<{
    open: boolean;
    fileName: string;
    materials: any[];
    vendors: any[];
    departments: any[];
    isOverwriting: boolean;
  }>({
    open: false,
    fileName: '',
    materials: [],
    vendors: [],
    departments: [],
    isOverwriting: false,
  });

  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canEdit = hasPermission(profile, 'canEditInventoryMaster');
  const canUpload = hasPermission(profile, 'canPerformMassUpload');

  // Real-time Firestore sync
  useEffect(() => {
    const qItems = query(collection(db, 'items'));
    const unsubItems = onSnapshot(qItems, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem));
      setItems(docs);
    });

    const qVendors = query(collection(db, 'vendors'));
    const unsubVendors = onSnapshot(qVendors, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Vendor));
      setVendors(docs);
    });

    const qDepts = query(collection(db, 'departments'));
    const unsubDepts = onSnapshot(qDepts, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setDepartments(docs);
    });

    return () => {
      unsubItems();
      unsubVendors();
      unsubDepts();
    };
  }, []);

  // Distinct Categories for Markdown Settings
  const distinctCategories = Array.from(
    new Set([
      'Bakery',
      'Beverages',
      'Perishable',
      'Grocery',
      'Household',
      'Electronics',
      'Office Supplies',
      ...items.map(i => i.category).filter(Boolean),
    ])
  ) as string[];

  // -------------------------------------------------------------
  // MasterDB.xlsx Multi-Sheet Export
  // -------------------------------------------------------------
  const handleExportMasterDbXlsx = () => {
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Materials
    // SKU | Product Name | Category | Stock Level | Min Safety Stock | Cost Price | Selling Price | Promo Price | Promo Start Date | Promo End Date | Preferred Vendor | Unit
    const materialsData = items.map(item => ({
      'SKU': item.sku || '',
      'Product Name': item.name || '',
      'Category': item.category || 'General',
      'Stock Level': item.currentStock || 0,
      'Min Safety Stock': item.minStock || 5,
      'Cost Price': item.cost_price ?? (item as any).costPrice ?? item.unitPrice ?? 0,
      'Selling Price': item.selling_price ?? (item as any).sellingPrice ?? item.unitPrice ?? 0,
      'Promo Price': (item.promotion_price !== undefined && item.promotion_price !== null && item.promotion_price !== '') ? Number(item.promotion_price) : '',
      'Promo Start Date': item.promoStartDate || item.promotionStartDate || '',
      'Promo End Date': item.promoEndDate || item.promotionEndDate || '',
      'Unit Price': item.selling_price ?? (item as any).sellingPrice ?? item.unitPrice ?? 0,
      'Preferred Vendor': item.vendorName || item.vendorCode || '',
      'Unit': item.unit || 'PCS',
    }));
    const wsMaterials = XLSX.utils.json_to_sheet(materialsData);
    XLSX.utils.book_append_sheet(workbook, wsMaterials, 'Materials');

    // Sheet 2: Vendors
    // Vendor Code | Vendor Name | Contact Person | Email | Phone | Address
    const vendorsData = vendors.map(v => ({
      'Vendor Code': v.vendorCode || '',
      'Vendor Name': v.name || '',
      'Contact Person': (v as any).contactPerson || '',
      'Email': v.email || '',
      'Phone': v.phone || '',
      'Address': v.address || '',
    }));
    const wsVendors = XLSX.utils.json_to_sheet(vendorsData);
    XLSX.utils.book_append_sheet(workbook, wsVendors, 'Vendors');

    // Sheet 3: Departments
    // Department Code | Department Name | Head of Department
    const deptsData = departments.map(d => ({
      'Department Code': d.code || '',
      'Department Name': d.name || '',
      'Head of Department': d.headOfDepartment || d.managerName || '',
    }));
    const wsDepts = XLSX.utils.json_to_sheet(deptsData);
    XLSX.utils.book_append_sheet(workbook, wsDepts, 'Departments');

    const fileName = 'MasterDB.xlsx';
    XLSX.writeFile(workbook, fileName);
    toast.success(`Generated standardized ${fileName} with Materials (${materialsData.length}), Vendors (${vendorsData.length}), and Departments (${deptsData.length}).`);
  };

  // -------------------------------------------------------------
  // MasterDB.xlsx Multi-Sheet Parser (Row 2 Onwards)
  // -------------------------------------------------------------
  const handleFileUpload = (file: File) => {
    if (!canUpload) {
      toast.error('Access Denied: You lack privilege to perform Mass Upload.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        let parsedMaterials: any[] = [];
        let parsedVendors: any[] = [];
        let parsedDepartments: any[] = [];

        // Parse Sheet: Materials
        const matSheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('material') || s.toLowerCase().includes('item') || s.toLowerCase().includes('inventor'));
        if (matSheetName) {
          const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[matSheetName]);
          parsedMaterials = rows.map((r, index) => {
            const costPrice = Number(r['Cost Price'] ?? r['Cost'] ?? r['cost_price'] ?? r['costPrice'] ?? r['Unit Cost'] ?? 0);
            const sellingPrice = Number(r['Selling Price'] ?? r['selling_price'] ?? r['Selling'] ?? r['sellingPrice'] ?? r['Unit Price'] ?? r['UnitPrice'] ?? r['price'] ?? 0);
            const rawPromo = r['Promo Price'] ?? r['promo_price'] ?? r['Promotion Price'] ?? r['promotionalPrice'] ?? r['promoPrice'] ?? r['Promo'];
            const promoPrice = (rawPromo !== undefined && rawPromo !== null && rawPromo !== '' && !isNaN(Number(rawPromo))) ? Number(rawPromo) : null;
            const promoStartDate = normalizeExcelDate(r['Promo Start Date'] ?? r['Promotion Start Date'] ?? r['promo_start_date'] ?? r['promoStartDate'] ?? r['Promo Start']);
            const promoEndDate = normalizeExcelDate(r['Promo End Date'] ?? r['Promotion End Date'] ?? r['promo_end_date'] ?? r['promoEndDate'] ?? r['Promo End']);

            return {
              sku: String(r['SKU'] || r['sku'] || `SKU-${Date.now()}-${index}`).trim(),
              name: String(r['Product Name'] || r['Name'] || r['name'] || 'Unnamed Product').trim(),
              category: String(r['Category'] || r['category'] || 'General').trim(),
              currentStock: Number(r['Stock Level'] ?? r['CurrentStock'] ?? r['stock'] ?? 0),
              minStock: Number(r['Min Safety Stock'] ?? r['MinStock'] ?? r['min_stock'] ?? 5),
              cost_price: isNaN(costPrice) ? 0 : costPrice,
              costPrice: isNaN(costPrice) ? 0 : costPrice,
              selling_price: isNaN(sellingPrice) ? 0 : sellingPrice,
              sellingPrice: isNaN(sellingPrice) ? 0 : sellingPrice,
              unitPrice: isNaN(sellingPrice) ? (isNaN(costPrice) ? 0 : costPrice) : sellingPrice,
              promotion_price: promoPrice,
              promotionalPrice: promoPrice,
              promoStartDate: promoStartDate,
              promoEndDate: promoEndDate,
              promotionStartDate: promoStartDate,
              promotionEndDate: promoEndDate,
              vendorName: String(r['Preferred Vendor'] || r['VendorName'] || r['vendor'] || '').trim(),
              vendorCode: String(r['Vendor Code'] || r['VendorCode'] || '').trim(),
              unit: String(r['Unit'] || r['unit'] || 'PCS').trim(),
            };
          });
        }

        // Parse Sheet: Vendors
        const vendSheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('vendor') || s.toLowerCase().includes('supplier'));
        if (vendSheetName) {
          const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[vendSheetName]);
          parsedVendors = rows.map((r, index) => ({
            vendorCode: String(r['Vendor Code'] || r['vendorCode'] || `VEND-${index + 1}`).trim(),
            name: String(r['Vendor Name'] || r['Name'] || r['name'] || 'Unnamed Vendor').trim(),
            contactPerson: String(r['Contact Person'] || r['contact'] || '').trim(),
            email: String(r['Email'] || r['email'] || '').trim(),
            phone: String(r['Phone'] || r['phone'] || '').trim(),
            address: String(r['Address'] || r['address'] || '').trim(),
            paymentTerms: 'Net 30',
            isInEcosystem: true,
          }));
        }

        // Parse Sheet: Departments
        const deptSheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('department') || s.toLowerCase().includes('dept'));
        if (deptSheetName) {
          const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[deptSheetName]);
          parsedDepartments = rows.map((r, index) => ({
            code: String(r['Department Code'] || r['Code'] || r['code'] || `DEPT-${index + 1}`).trim(),
            name: String(r['Department Name'] || r['Name'] || r['name'] || 'Department').trim(),
            headOfDepartment: String(r['Head of Department'] || r['Head'] || r['manager'] || '').trim(),
            description: `Department managed by ${r['Head of Department'] || 'HOD'}`,
          }));
        }

        if (parsedMaterials.length === 0 && parsedVendors.length === 0 && parsedDepartments.length === 0) {
          toast.error('No readable rows found in MasterDB.xlsx. Verify sheet names: Materials, Vendors, Departments.');
          return;
        }

        setImportPreview({
          open: true,
          fileName: file.name,
          materials: parsedMaterials,
          vendors: parsedVendors,
          departments: parsedDepartments,
          isOverwriting: false,
        });
      } catch (err: any) {
        console.error(err);
        toast.error('Failed to parse MasterDB.xlsx: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Commit Import to Firestore
  const handleCommitImport = async () => {
    setSaving(true);
    try {
      const batch = writeBatch(db);
      let totalCount = 0;

      // Commit Materials
      for (const m of importPreview.materials) {
        const existing = items.find(i => i.sku?.toLowerCase() === m.sku?.toLowerCase());
        const docRef = existing ? doc(db, 'items', existing.id) : doc(collection(db, 'items'));
        const sellingPrice = Number(m.selling_price) || Number(m.unitPrice) || 0;
        const costPrice = Number(m.cost_price) || 0;
        const promoPrice = (m.promotion_price !== null && m.promotion_price !== undefined && m.promotion_price !== '') 
          ? Number(m.promotion_price) 
          : null;

        batch.set(docRef, {
          sku: m.sku,
          name: m.name,
          category: m.category,
          currentStock: m.currentStock,
          minStock: m.minStock,
          cost_price: costPrice,
          costPrice: costPrice,
          selling_price: sellingPrice,
          sellingPrice: sellingPrice,
          unitPrice: sellingPrice || costPrice,
          materialQuotedPrice: costPrice || sellingPrice,
          promotion_price: promoPrice,
          promotionalPrice: promoPrice,
          promoStartDate: m.promoStartDate || null,
          promoEndDate: m.promoEndDate || null,
          promotionStartDate: m.promoStartDate || null,
          promotionEndDate: m.promoEndDate || null,
          vendorName: m.vendorName || '',
          vendorCode: m.vendorCode || '',
          unit: m.unit || 'PCS',
          lastUpdated: Timestamp.now(),
        }, { merge: !importPreview.isOverwriting });
        totalCount++;
      }

      // Commit Vendors
      for (const v of importPreview.vendors) {
        const existing = vendors.find(vend => vend.vendorCode?.toLowerCase() === v.vendorCode?.toLowerCase());
        const docRef = existing ? doc(db, 'vendors', existing.id) : doc(collection(db, 'vendors'));
        batch.set(docRef, {
          vendorCode: v.vendorCode,
          name: v.name,
          contactPerson: v.contactPerson,
          email: v.email,
          phone: v.phone,
          address: v.address,
          paymentTerms: v.paymentTerms || 'Net 30',
          isInEcosystem: true,
        }, { merge: !importPreview.isOverwriting });
        totalCount++;
      }

      // Commit Departments
      for (const d of importPreview.departments) {
        const existing = departments.find(dept => dept.code?.toLowerCase() === d.code?.toLowerCase());
        const docRef = existing ? doc(db, 'departments', existing.id) : doc(collection(db, 'departments'));
        batch.set(docRef, {
          code: d.code,
          name: d.name,
          headOfDepartment: d.headOfDepartment,
          description: d.description || '',
        }, { merge: !importPreview.isOverwriting });
        totalCount++;
      }

      await batch.commit();
      toast.success(`Successfully synchronized Master Database! Processed ${totalCount} records.`);
      setImportPreview(prev => ({ ...prev, open: false }));
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to commit MasterDB sync: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------
  // In-App CRUD & Batch Operations: Materials
  // -------------------------------------------------------------
  const handleOpenItemModal = (item?: InventoryItem) => {
    if (item) {
      setSelectedItem(item);
      setItemForm({
        sku: item.sku || '',
        name: item.name || '',
        description: item.description || '',
        unit: item.unit || 'PCS',
        currentStock: item.currentStock || 0,
        minStock: item.minStock || 5,
        unitPrice: item.unitPrice || item.selling_price || (item as any).sellingPrice || 0,
        cost_price: item.cost_price ?? (item as any).costPrice ?? item.unitPrice ?? 0,
        selling_price: item.selling_price ?? (item as any).sellingPrice ?? item.unitPrice ?? 0,
        promotion_price: (item.promotion_price ?? (item as any).promotionalPrice) ? Number(item.promotion_price ?? (item as any).promotionalPrice) : '',
        promoStartDate: item.promoStartDate || item.promotionStartDate || '',
        promoEndDate: item.promoEndDate || item.promotionEndDate || '',
        isActive: item.isActive !== false && item.status !== 'inactive',
        status: (item.status === 'inactive' || item.isActive === false) ? 'inactive' : 'active',
        trackingType: item.trackingType || 'standard',
        batchNumber: item.batchNumber || '',
        expiryDate: item.expiryDate || '',
        serialNumber: item.serialNumber || '',
        vendorCode: item.vendorCode || '',
        vendorName: item.vendorName || '',
        category: item.category || 'General',
      });
    } else {
      setSelectedItem(null);
      setItemForm({
        sku: `SKU-${Date.now().toString().slice(-5)}`,
        name: '',
        description: '',
        unit: 'PCS',
        currentStock: 0,
        minStock: 5,
        unitPrice: 0,
        cost_price: 0,
        selling_price: 0,
        promotion_price: '',
        promoStartDate: '',
        promoEndDate: '',
        isActive: true,
        status: 'active',
        trackingType: 'standard',
        batchNumber: '',
        expiryDate: '',
        serialNumber: '',
        vendorCode: '',
        vendorName: '',
        category: 'General',
      });
    }
    setIsItemModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error('Access Denied: You lack privilege to modify inventory items.');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        sku: itemForm.sku,
        name: itemForm.name,
        description: itemForm.description,
        unit: itemForm.unit,
        currentStock: itemForm.currentStock,
        minStock: itemForm.minStock,
        minSafetyStock: itemForm.minStock,
        unitPrice: itemForm.selling_price || itemForm.unitPrice,
        materialQuotedPrice: itemForm.cost_price || itemForm.unitPrice,
        cost_price: Number(itemForm.cost_price) || 0,
        costPrice: Number(itemForm.cost_price) || 0,
        selling_price: Number(itemForm.selling_price) || Number(itemForm.unitPrice) || 0,
        sellingPrice: Number(itemForm.selling_price) || Number(itemForm.unitPrice) || 0,
        promotion_price: itemForm.promotion_price === '' ? null : Number(itemForm.promotion_price),
        promotionalPrice: itemForm.promotion_price === '' ? null : Number(itemForm.promotion_price),
        promoStartDate: itemForm.promoStartDate || null,
        promoEndDate: itemForm.promoEndDate || null,
        promotionStartDate: itemForm.promoStartDate || null,
        promotionEndDate: itemForm.promoEndDate || null,
        isActive: itemForm.isActive,
        status: itemForm.isActive ? 'active' : 'inactive',
        trackingType: itemForm.trackingType,
        batchNumber: itemForm.batchNumber || null,
        expiryDate: itemForm.expiryDate || null,
        serialNumber: itemForm.serialNumber || null,
        vendorCode: itemForm.vendorCode,
        vendorName: itemForm.vendorName,
        category: itemForm.category,
        lastUpdated: Timestamp.now(),
      };

      if (selectedItem) {
        const ref = doc(db, 'items', selectedItem.id);
        await updateDoc(ref, payload);
        toast.success(`Updated SKU ${itemForm.sku} (${itemForm.name})`);
      } else {
        const ref = doc(collection(db, 'items'));
        await setDoc(ref, {
          ...payload,
          createdAt: Timestamp.now(),
        });
        toast.success(`Created SKU ${itemForm.sku}`);
      }
      setIsItemModalOpen(false);
    } catch (err: any) {
      toast.error('Failed to save SKU: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Batch actions on selected materials
  const handleToggleSelectAll = () => {
    if (selectedItemIds.length === filteredItems.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(filteredItems.map(i => i.id));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedItemIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleBatchDeactivate = async () => {
    if (selectedItemIds.length === 0) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach(id => {
        const ref = doc(db, 'items', id);
        batch.update(ref, {
          isActive: false,
          status: 'inactive',
          lastUpdated: Timestamp.now(),
        });
      });
      await batch.commit();
      toast.success(`Successfully deactivated ${selectedItemIds.length} materials.`);
      setSelectedItemIds([]);
    } catch (err: any) {
      toast.error('Batch deactivation failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBatchActivate = async () => {
    if (selectedItemIds.length === 0) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach(id => {
        const ref = doc(db, 'items', id);
        batch.update(ref, {
          isActive: true,
          status: 'active',
          lastUpdated: Timestamp.now(),
        });
      });
      await batch.commit();
      toast.success(`Successfully activated ${selectedItemIds.length} materials.`);
      setSelectedItemIds([]);
    } catch (err: any) {
      toast.error('Batch activation failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedItemIds.length === 0) return;
    if (!confirm(`Are you sure you want to permanently delete ${selectedItemIds.length} materials? This action cannot be undone.`)) {
      return;
    }
    setSaving(true);
    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach(id => {
        const ref = doc(db, 'items', id);
        batch.delete(ref);
      });
      await batch.commit();
      toast.success(`Deleted ${selectedItemIds.length} materials.`);
      setSelectedItemIds([]);
    } catch (err: any) {
      toast.error('Batch delete failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------
  // In-App CRUD: Vendors
  // -------------------------------------------------------------
  const handleOpenVendorModal = (vendor?: Vendor) => {
    if (vendor) {
      setSelectedVendor(vendor);
      setVendorForm({
        vendorCode: vendor.vendorCode || '',
        name: vendor.name || '',
        contactPerson: (vendor as any).contactPerson || '',
        email: vendor.email || '',
        phone: vendor.phone || '',
        address: vendor.address || '',
        category: vendor.category || 'Supplier',
        paymentTerms: vendor.paymentTerms || 'Net 30',
      });
    } else {
      setSelectedVendor(null);
      setVendorForm({
        vendorCode: `VEND-${Date.now().toString().slice(-4)}`,
        name: '',
        contactPerson: '',
        email: '',
        phone: '',
        address: '',
        category: 'Supplier',
        paymentTerms: 'Net 30',
      });
    }
    setIsVendorModalOpen(true);
  };

  const handleSaveVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error('Access Denied: You lack privilege to modify vendors.');
      return;
    }
    setSaving(true);
    try {
      if (selectedVendor) {
        const ref = doc(db, 'vendors', selectedVendor.id);
        await updateDoc(ref, {
          ...vendorForm,
          isInEcosystem: true,
        });
        toast.success(`Updated vendor ${vendorForm.name}`);
      } else {
        const ref = doc(collection(db, 'vendors'));
        await setDoc(ref, {
          ...vendorForm,
          isInEcosystem: true,
        });
        toast.success(`Registered vendor ${vendorForm.vendorCode}`);
      }
      setIsVendorModalOpen(false);
    } catch (err: any) {
      toast.error('Failed to save vendor: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------
  // In-App CRUD: Departments
  // -------------------------------------------------------------
  const handleOpenDeptModal = (dept?: any) => {
    if (dept) {
      setSelectedDept(dept);
      setDeptForm({
        code: dept.code || '',
        name: dept.name || '',
        headOfDepartment: dept.headOfDepartment || '',
        description: dept.description || '',
      });
    } else {
      setSelectedDept(null);
      setDeptForm({
        code: `DEPT-${Date.now().toString().slice(-3)}`,
        name: '',
        headOfDepartment: '',
        description: '',
      });
    }
    setIsDeptModalOpen(true);
  };

  const handleSaveDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error('Access Denied: You lack privilege to modify departments.');
      return;
    }
    setSaving(true);
    try {
      if (selectedDept) {
        const ref = doc(db, 'departments', selectedDept.id);
        await updateDoc(ref, { ...deptForm });
        toast.success(`Updated department ${deptForm.name}`);
      } else {
        const ref = doc(collection(db, 'departments'));
        await setDoc(ref, { ...deptForm });
        toast.success(`Created department ${deptForm.code}`);
      }
      setIsDeptModalOpen(false);
    } catch (err: any) {
      toast.error('Failed to save department: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Delete Action Executor
  const handleConfirmDelete = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      if (deleteConfirm.type === 'item') {
        await deleteDoc(doc(db, 'items', deleteConfirm.id));
        toast.success('Inventory SKU removed.');
      } else if (deleteConfirm.type === 'vendor') {
        await deleteDoc(doc(db, 'vendors', deleteConfirm.id));
        toast.success('Vendor profile removed.');
      } else {
        await deleteDoc(doc(db, 'departments', deleteConfirm.id));
        toast.success('Department entry removed.');
      }
      setDeleteConfirm({ open: false, type: 'item', id: '', title: '' });
    } catch (err: any) {
      toast.error('Delete failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Search filtering
  const filteredItems = items.filter(i => 
    (i.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (i.sku || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (i.category || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (i.vendorName || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredVendors = vendors.filter(v => 
    (v.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.vendorCode || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.email || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredDepts = departments.filter(d => 
    (d.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (d.code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (d.headOfDepartment || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Master Database Sync & Sheet Configuration</h1>
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-semibold">
                MasterDB.xlsx Engine
              </Badge>
            </div>
            <p className="text-sm text-slate-500">
              Single-file multi-sheet processing (Materials, Vendors, Departments), timed markdown window, and granular RBAC.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Button 
            variant="outline" 
            onClick={handleExportMasterDbXlsx}
            className="text-xs h-9 gap-1.5 border-slate-300 hover:bg-slate-50"
          >
            <DownloadCloud className="w-4 h-4 text-blue-600" /> Download MasterDB.xlsx
          </Button>

          <Button 
            variant="outline" 
            onClick={() => fileInputRef.current?.click()}
            disabled={!canUpload}
            className="text-xs h-9 gap-1.5 border-slate-300 hover:bg-slate-50"
          >
            <UploadCloud className="w-4 h-4 text-emerald-600" /> Upload MasterDB.xlsx
          </Button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={(e) => {
              if (e.target.files?.[0]) {
                handleFileUpload(e.target.files[0]);
                e.target.value = '';
              }
            }} 
            accept=".xlsx, .xls, .csv" 
            className="hidden" 
          />

          {activeTab === 'materials' && (
            <Button 
              onClick={() => handleOpenItemModal()}
              disabled={!canEdit}
              className="text-xs h-9 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Material / SKU
            </Button>
          )}

          {activeTab === 'vendors' && (
            <Button 
              onClick={() => handleOpenVendorModal()}
              disabled={!canEdit}
              className="text-xs h-9 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Vendor
            </Button>
          )}

          {activeTab === 'departments' && (
            <Button 
              onClick={() => handleOpenDeptModal()}
              disabled={!canEdit}
              className="text-xs h-9 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Department
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
        <TabsList className="bg-slate-100 p-1 rounded-xl">
          <TabsTrigger value="materials" className="gap-2 text-xs">
            <Package className="w-3.5 h-3.5" /> Materials ({items.length})
          </TabsTrigger>
          <TabsTrigger value="vendors" className="gap-2 text-xs">
            <Truck className="w-3.5 h-3.5" /> Vendors ({vendors.length})
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-2 text-xs">
            <Building2 className="w-3.5 h-3.5" /> Departments ({departments.length})
          </TabsTrigger>
          <TabsTrigger value="markdown" className="gap-2 text-xs">
            <Clock className="w-3.5 h-3.5 text-amber-600" /> Timed Markdown Settings
          </TabsTrigger>
          <TabsTrigger value="rbac" className="gap-2 text-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" /> User Access Matrix
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Materials Sheet */}
        <TabsContent value="materials" className="space-y-4 pt-3">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">Materials Master Catalog</CardTitle>
                <CardDescription className="text-xs">
                  Header Mapping: SKU | Product Name | Category | Stock Level | Min Safety Stock | Unit Price | Preferred Vendor
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <Input 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search SKU, name, vendor..."
                  className="pl-9 h-8 text-xs bg-white"
                />
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* Batch Action Bar */}
              {selectedItemIds.length > 0 && (
                <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-blue-400" />
                    <span className="font-semibold">{selectedItemIds.length} materials selected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={handleBatchActivate}
                      disabled={saving}
                      className="h-7 text-xs bg-transparent text-emerald-400 border-emerald-500/50 hover:bg-emerald-950/40"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Activate
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={handleBatchDeactivate}
                      disabled={saving}
                      className="h-7 text-xs bg-transparent text-amber-400 border-amber-500/50 hover:bg-amber-950/40"
                    >
                      <Ban className="w-3.5 h-3.5 mr-1" /> Deactivate (POS Live-Sync)
                    </Button>
                    <Button 
                      size="sm" 
                      variant="destructive" 
                      onClick={handleBatchDelete}
                      disabled={saving}
                      className="h-7 text-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Selected
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => setSelectedItemIds([])}
                      className="h-7 text-xs text-slate-300 hover:text-white"
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}

              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="w-10 text-center">
                      <button 
                        type="button" 
                        onClick={handleToggleSelectAll} 
                        className="text-slate-500 hover:text-slate-700"
                      >
                        {filteredItems.length > 0 && selectedItemIds.length === filteredItems.length ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="text-xs font-semibold">SKU & Status</TableHead>
                    <TableHead className="text-xs font-semibold">Product Name & Tracking</TableHead>
                    <TableHead className="text-xs font-semibold">Category</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Stock Level</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Min Safety</TableHead>
                    {isExecutive ? (
                      <>
                        <TableHead className="text-right text-xs font-semibold text-slate-700">Cost Price</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-emerald-700">Selling Price</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-purple-700">Promo Price</TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="text-right text-xs font-semibold text-slate-400">Cost Price</TableHead>
                        <TableHead className="text-right text-xs font-semibold text-emerald-700">Effective Price</TableHead>
                      </>
                    )}
                    <TableHead className="text-xs font-semibold">Preferred Vendor</TableHead>
                    <TableHead className="text-center text-xs font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isExecutive ? 10 : 9} className="text-center py-10 text-slate-400 text-xs">
                        No materials matching "{searchTerm}".
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map(item => {
                      const isSelected = selectedItemIds.includes(item.id);
                      const isItemActive = item.isActive !== false && item.status !== 'inactive';
                      const costVal = item.cost_price ?? item.costPrice ?? item.unitPrice ?? 0;
                      const sellingVal = item.selling_price ?? item.sellingPrice ?? item.unitPrice ?? 0;
                      const promoDetails = getItemPromotionDetails(item);

                      return (
                        <TableRow key={item.id} className={`hover:bg-slate-50/70 ${isSelected ? 'bg-blue-50/40' : ''} ${!isItemActive ? 'opacity-60 bg-slate-50/30' : ''}`}>
                          <TableCell className="text-center">
                            <button 
                              type="button" 
                              onClick={() => handleToggleSelect(item.id)}
                              className="text-slate-500 hover:text-slate-700"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-blue-600" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="font-mono text-xs font-bold text-blue-700">{item.sku}</div>
                            <div className="mt-0.5">
                              {isItemActive ? (
                                <span className="inline-flex items-center text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                  Active (POS Ready)
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-300">
                                  Deactivated
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold text-xs text-slate-900">{item.name}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {item.trackingType === 'batch' ? (
                                <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                                  Batch Tracked
                                </Badge>
                              ) : item.trackingType === 'serial' ? (
                                <Badge variant="outline" className="text-[9px] bg-purple-50 text-purple-700 border-purple-200">
                                  Serial Tracked
                                </Badge>
                              ) : null}
                              <span className="text-[11px] text-slate-400 truncate max-w-xs">{item.description}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{item.category || 'General'}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold">
                            {item.currentStock || 0} {item.unit || 'PCS'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-slate-500">
                            {item.minSafetyStock || item.minStock || 5} {item.unit || 'PCS'}
                          </TableCell>
                          
                          {/* Role-Based Pricing Columns */}
                          {isExecutive ? (
                            <>
                              <TableCell className="text-right font-mono text-xs font-medium text-slate-700">
                                ${costVal.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">
                                ${sellingVal.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {promoDetails.hasPromoPriceConfigured ? (
                                  promoDetails.isPromoActive ? (
                                    <div className="flex flex-col items-end">
                                      <span className="bg-purple-50 text-purple-700 font-bold px-1.5 py-0.5 rounded border border-purple-200">
                                        ${promoDetails.promoPrice?.toFixed(2)}
                                      </span>
                                      <span className="text-[9px] text-purple-600 font-medium mt-0.5">
                                        {promoDetails.statusLabel}
                                      </span>
                                    </div>
                                  ) : promoDetails.status === 'expired' ? (
                                    <div className="flex flex-col items-end" title={`Promotion ended on ${promoDetails.endDate}`}>
                                      <span className="bg-slate-100 text-slate-400 line-through px-1.5 py-0.5 rounded border border-slate-200">
                                        ${promoDetails.promoPrice?.toFixed(2)}
                                      </span>
                                      <span className="text-[9px] text-rose-500 font-semibold mt-0.5">
                                        Ended {promoDetails.endDate}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex flex-col items-end" title={`Promotion starts on ${promoDetails.startDate}`}>
                                      <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">
                                        ${promoDetails.promoPrice?.toFixed(2)}
                                      </span>
                                      <span className="text-[9px] text-blue-600 font-medium mt-0.5">
                                        Starts {promoDetails.startDate}
                                      </span>
                                    </div>
                                  )
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell className="text-right font-mono text-xs text-slate-400 italic">
                                <span className="flex items-center justify-end gap-1" title="Cost price restricted to Executive Roles">
                                  <EyeOff className="w-3 h-3 text-slate-400" /> ***
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">
                                {promoDetails.isPromoActive ? (
                                  <div className="flex flex-col items-end">
                                    <span className="line-through text-slate-400 text-[10px]">
                                      ${sellingVal.toFixed(2)}
                                    </span>
                                    <span className="text-purple-700 font-bold">
                                      ${promoDetails.promoPrice?.toFixed(2)}
                                    </span>
                                    <span className="text-[9px] text-purple-600 font-medium">
                                      {promoDetails.statusLabel}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-end">
                                    <span>${sellingVal.toFixed(2)}</span>
                                    {promoDetails.status === 'expired' && (
                                      <span className="text-[9px] text-slate-400 font-normal">
                                        Promo ended
                                      </span>
                                    )}
                                  </div>
                                )}
                              </TableCell>
                            </>
                          )}

                          <TableCell className="text-xs text-slate-600">
                            {item.vendorName || item.vendorCode || '—'}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenItemModal(item)}
                                disabled={!canEdit}
                                className="h-7 w-7 p-0 text-slate-600 hover:text-blue-600"
                                title="Edit SKU"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirm({
                                  open: true,
                                  type: 'item',
                                  id: item.id,
                                  title: `${item.sku} - ${item.name}`,
                                })}
                                disabled={!canEdit}
                                className="h-7 w-7 p-0 text-slate-600 hover:text-rose-600"
                                title="Delete SKU"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: Vendors Sheet */}
        <TabsContent value="vendors" className="space-y-4 pt-3">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">Vendors Directory</CardTitle>
                <CardDescription className="text-xs">
                  Header Mapping: Vendor Code | Vendor Name | Contact Person | Email | Phone | Address
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <Input 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search vendor code, name..."
                  className="pl-9 h-8 text-xs bg-white"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Vendor Code</TableHead>
                    <TableHead className="text-xs font-semibold">Vendor Name</TableHead>
                    <TableHead className="text-xs font-semibold">Contact Person</TableHead>
                    <TableHead className="text-xs font-semibold">Email</TableHead>
                    <TableHead className="text-xs font-semibold">Phone</TableHead>
                    <TableHead className="text-xs font-semibold">Address</TableHead>
                    <TableHead className="text-center text-xs font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVendors.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-slate-400 text-xs">
                        No vendors registered.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredVendors.map(v => (
                      <TableRow key={v.id} className="hover:bg-slate-50/70">
                        <TableCell className="font-mono text-xs font-bold text-slate-700">{v.vendorCode}</TableCell>
                        <TableCell className="font-semibold text-xs text-slate-900">{v.name}</TableCell>
                        <TableCell className="text-xs text-slate-600">{(v as any).contactPerson || '—'}</TableCell>
                        <TableCell className="text-xs text-slate-600">{v.email}</TableCell>
                        <TableCell className="text-xs text-slate-600">{v.phone || '—'}</TableCell>
                        <TableCell className="text-xs text-slate-500 truncate max-w-xs">{v.address || '—'}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenVendorModal(v)}
                              disabled={!canEdit}
                              className="h-7 w-7 p-0 text-slate-600 hover:text-blue-600"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm({
                                open: true,
                                type: 'vendor',
                                id: v.id,
                                title: `${v.vendorCode} - ${v.name}`,
                              })}
                              disabled={!canEdit}
                              className="h-7 w-7 p-0 text-slate-600 hover:text-rose-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: Departments Sheet */}
        <TabsContent value="departments" className="space-y-4 pt-3">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">Departments & Cost Centers</CardTitle>
                <CardDescription className="text-xs">
                  Header Mapping: Department Code | Department Name | Head of Department
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <Input 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search department code, HOD..."
                  className="pl-9 h-8 text-xs bg-white"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Department Code</TableHead>
                    <TableHead className="text-xs font-semibold">Department Name</TableHead>
                    <TableHead className="text-xs font-semibold">Head of Department</TableHead>
                    <TableHead className="text-xs font-semibold">Description</TableHead>
                    <TableHead className="text-center text-xs font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDepts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-slate-400 text-xs">
                        No departments registered.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDepts.map(d => (
                      <TableRow key={d.id} className="hover:bg-slate-50/70">
                        <TableCell className="font-mono text-xs font-bold text-blue-700">{d.code}</TableCell>
                        <TableCell className="font-semibold text-xs text-slate-900">{d.name}</TableCell>
                        <TableCell className="text-xs font-medium text-slate-700">{d.headOfDepartment || '—'}</TableCell>
                        <TableCell className="text-xs text-slate-500">{d.description || '—'}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenDeptModal(d)}
                              disabled={!canEdit}
                              className="h-7 w-7 p-0 text-slate-600 hover:text-blue-600"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm({
                                open: true,
                                type: 'dept',
                                id: d.id,
                                title: `${d.code} - ${d.name}`,
                              })}
                              disabled={!canEdit}
                              className="h-7 w-7 p-0 text-slate-600 hover:text-rose-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: Timed Markdown Window */}
        <TabsContent value="markdown" className="space-y-4 pt-3">
          <TimedMarkdownSettings currentUser={profile} categories={distinctCategories} />
        </TabsContent>

        {/* TAB 5: User Access Management */}
        <TabsContent value="rbac" className="space-y-4 pt-3">
          <UserAccessManagement currentUser={profile} />
        </TabsContent>
      </Tabs>

      {/* Edit/Add Material Modal */}
      <Dialog open={isItemModalOpen} onOpenChange={setIsItemModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {selectedItem ? `Edit SKU: ${selectedItem.sku}` : 'Add New Material / SKU'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Directly synchronize unit price, safety stock threshold, and preferred supplier.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveItem} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">SKU Code *</Label>
                <Input 
                  value={itemForm.sku}
                  onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })}
                  placeholder="e.g. SKU-1001"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Category</Label>
                <Input 
                  value={itemForm.category}
                  onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                  placeholder="e.g. Office Supplies"
                />
              </div>

              <div className="space-y-1 col-span-2">
                <Label className="text-xs font-semibold">Product Name *</Label>
                <Input 
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="e.g. Wireless Ergonomic Scanner"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Stock Level</Label>
                <Input 
                  type="number"
                  value={itemForm.currentStock}
                  onChange={(e) => setItemForm({ ...itemForm, currentStock: parseInt(e.target.value, 10) || 0 })}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Min Safety Stock</Label>
                <Input 
                  type="number"
                  value={itemForm.minStock}
                  onChange={(e) => setItemForm({ ...itemForm, minStock: parseInt(e.target.value, 10) || 0 })}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Unit of Measure</Label>
                <Input 
                  value={itemForm.unit}
                  onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                  placeholder="PCS, BOX, KG"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Status / Catalog State</Label>
                <select
                  value={itemForm.isActive ? 'active' : 'inactive'}
                  onChange={(e) => setItemForm({ ...itemForm, isActive: e.target.value === 'active' })}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                >
                  <option value="active">Active (POS & Movements Enabled)</option>
                  <option value="inactive">Deactivated (Discontinued / Blocked)</option>
                </select>
              </div>

              {/* Pricing Section */}
              <div className="col-span-2 p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Role-Based Product Pricing Engine
                  </span>
                  {isExecutive ? (
                    <Badge className="bg-blue-600 text-white text-[10px]">Executive Privileges Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-slate-500 text-[10px]">Cost Price Restricted</Badge>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold flex items-center gap-1">
                      Cost Price ($)
                      {!isExecutive && <EyeOff className="w-3 h-3 text-slate-400" />}
                    </Label>
                    {isExecutive ? (
                      <Input 
                        type="number"
                        step="0.01"
                        value={itemForm.cost_price}
                        onChange={(e) => setItemForm({ ...itemForm, cost_price: parseFloat(e.target.value) || 0 })}
                        placeholder="0.00"
                        className="font-mono text-xs bg-white"
                      />
                    ) : (
                      <Input 
                        value="*** (Restricted)"
                        disabled
                        className="font-mono text-xs bg-slate-100 text-slate-400"
                      />
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Selling Price ($) *</Label>
                    <Input 
                      type="number"
                      step="0.01"
                      value={itemForm.selling_price}
                      onChange={(e) => setItemForm({ 
                        ...itemForm, 
                        selling_price: parseFloat(e.target.value) || 0,
                        unitPrice: parseFloat(e.target.value) || 0 
                      })}
                      placeholder="0.00"
                      required
                      className="font-mono text-xs bg-white font-bold text-emerald-700"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Promotional Price ($)</Label>
                    <Input 
                      type="number"
                      step="0.01"
                      value={itemForm.promotion_price}
                      onChange={(e) => setItemForm({ 
                        ...itemForm, 
                        promotion_price: e.target.value === '' ? '' : parseFloat(e.target.value) 
                      })}
                      placeholder="Optional promo"
                      className="font-mono text-xs bg-white text-purple-700"
                    />
                  </div>

                  {/* Promotion Period Setting */}
                  <div className="col-span-3 pt-2 border-t border-slate-200/80 mt-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-purple-600" />
                        Promotion Period Setting
                      </span>
                      {itemForm.promotion_price !== '' && Number(itemForm.promotion_price) > 0 && (
                        (() => {
                          const details = getItemPromotionDetails({
                            selling_price: itemForm.selling_price,
                            promotion_price: Number(itemForm.promotion_price),
                            promoStartDate: itemForm.promoStartDate,
                            promoEndDate: itemForm.promoEndDate,
                          });
                          return (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${details.badgeColor}`}>
                              {details.statusLabel}
                            </span>
                          );
                        })()
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[11px] font-medium text-slate-600">Promo Start Date</Label>
                        <Input
                          type="date"
                          value={itemForm.promoStartDate}
                          onChange={(e) => setItemForm({ ...itemForm, promoStartDate: e.target.value })}
                          className="font-mono text-xs bg-white"
                        />
                        <span className="text-[10px] text-slate-400 block">Optional. Begins at 00:00:00 on this day</span>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[11px] font-medium text-slate-600">Promo End Date *</Label>
                        <Input
                          type="date"
                          value={itemForm.promoEndDate}
                          onChange={(e) => setItemForm({ ...itemForm, promoEndDate: e.target.value })}
                          className="font-mono text-xs bg-white"
                        />
                        <span className="text-[10px] text-slate-400 block">Promo price stops after this day (23:59:59)</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-600 bg-purple-50/70 p-2.5 rounded-lg border border-purple-100 flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
                      <span>
                        <strong>Automated Expiration:</strong> During the active window, POS automatically sells at the promotional price (${Number(itemForm.promotion_price || 0).toFixed(2)}). Once the promo end date is reached, the price immediately reverts back to standard Selling Price (${Number(itemForm.selling_price || 0).toFixed(2)}).
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tracking & Traceability */}
              <div className="col-span-2 p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Inventory Tracking & Traceability
                </span>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Tracking Type</Label>
                    <select
                      value={itemForm.trackingType}
                      onChange={(e) => setItemForm({ ...itemForm, trackingType: e.target.value as any })}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                    >
                      <option value="standard">Standard Inventory</option>
                      <option value="batch">Batch / Lot Tracked</option>
                      <option value="serial">Serial Number Tracked</option>
                    </select>
                  </div>

                  {itemForm.trackingType === 'batch' && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold">Batch / Lot #</Label>
                        <Input 
                          value={itemForm.batchNumber}
                          onChange={(e) => setItemForm({ ...itemForm, batchNumber: e.target.value })}
                          placeholder="e.g. LOT-2026-A"
                          className="text-xs bg-white font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold">Expiry Date</Label>
                        <Input 
                          type="date"
                          value={itemForm.expiryDate}
                          onChange={(e) => setItemForm({ ...itemForm, expiryDate: e.target.value })}
                          className="text-xs bg-white"
                        />
                      </div>
                    </>
                  )}

                  {itemForm.trackingType === 'serial' && (
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs font-semibold">Serial Number</Label>
                      <Input 
                        value={itemForm.serialNumber}
                        onChange={(e) => setItemForm({ ...itemForm, serialNumber: e.target.value })}
                        placeholder="e.g. SN-987654321"
                        className="text-xs bg-white font-mono"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1 col-span-2">
                <Label className="text-xs font-semibold">Preferred Vendor</Label>
                <select
                  value={itemForm.vendorName}
                  onChange={(e) => {
                    const name = e.target.value;
                    const v = vendors.find(vend => vend.name === name);
                    setItemForm({
                      ...itemForm,
                      vendorName: name,
                      vendorCode: v ? v.vendorCode : '',
                    });
                  }}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                >
                  <option value="">-- Select Preferred Vendor --</option>
                  {vendors.map(v => (
                    <option key={v.vendorCode} value={v.name}>
                      {v.vendorCode} - {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter className="border-t border-slate-100 pt-3">
              <Button type="button" variant="outline" onClick={() => setIsItemModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save SKU Details
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit/Add Vendor Modal */}
      <Dialog open={isVendorModalOpen} onOpenChange={setIsVendorModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {selectedVendor ? `Edit Vendor: ${selectedVendor.vendorCode}` : 'Register New Vendor'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Keep supplier contact info and payment terms up to date.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveVendor} className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Vendor Code *</Label>
              <Input 
                value={vendorForm.vendorCode}
                onChange={(e) => setVendorForm({ ...vendorForm, vendorCode: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Vendor Company Name *</Label>
              <Input 
                value={vendorForm.name}
                onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Contact Person</Label>
              <Input 
                value={vendorForm.contactPerson}
                onChange={(e) => setVendorForm({ ...vendorForm, contactPerson: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Email</Label>
                <Input 
                  type="email"
                  value={vendorForm.email}
                  onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Phone</Label>
                <Input 
                  value={vendorForm.phone}
                  onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Address</Label>
              <Input 
                value={vendorForm.address}
                onChange={(e) => setVendorForm({ ...vendorForm, address: e.target.value })}
              />
            </div>

            <DialogFooter className="border-t border-slate-100 pt-3">
              <Button type="button" variant="outline" onClick={() => setIsVendorModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save Vendor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit/Add Department Modal */}
      <Dialog open={isDeptModalOpen} onOpenChange={setIsDeptModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {selectedDept ? `Edit Department: ${selectedDept.code}` : 'Add Department / Cost Center'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Organizational unit for PR charging and shift rostering.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveDept} className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Department Code *</Label>
              <Input 
                value={deptForm.code}
                onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
                placeholder="e.g. DEPT-WH"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Department Name *</Label>
              <Input 
                value={deptForm.name}
                onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                placeholder="e.g. Warehouse & Storage"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Head of Department (HOD)</Label>
              <Input 
                value={deptForm.headOfDepartment}
                onChange={(e) => setDeptForm({ ...deptForm, headOfDepartment: e.target.value })}
                placeholder="e.g. Marcus Tan"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Description</Label>
              <Input 
                value={deptForm.description}
                onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
                placeholder="Scope of operations"
              />
            </div>

            <DialogFooter className="border-t border-slate-100 pt-3">
              <Button type="button" variant="outline" onClick={() => setIsDeptModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save Department
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={deleteConfirm.open} onOpenChange={(open) => !open && setDeleteConfirm(prev => ({ ...prev, open: false }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-rose-600 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              Confirm Record Deletion
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to permanently delete:
              <br />
              <strong className="text-slate-900 mt-1 block">{deleteConfirm.title}</strong>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(prev => ({ ...prev, open: false }))}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleConfirmDelete} 
              disabled={saving}
              className="gap-1.5"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Multi-Sheet Import Preview Modal */}
      <Dialog open={importPreview.open} onOpenChange={(open) => !open && setImportPreview(prev => ({ ...prev, open: false }))}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              Sync MasterDB.xlsx Spreadsheet
            </DialogTitle>
            <DialogDescription className="text-xs">
              Processed tabs from uploaded file: <strong>{importPreview.fileName}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-center">
                <span className="text-[11px] font-semibold text-blue-700 block">Sheet 1: Materials</span>
                <span className="text-2xl font-bold text-blue-900">{importPreview.materials.length}</span>
                <span className="text-[10px] text-blue-600 block mt-0.5">Records parsed</span>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                <span className="text-[11px] font-semibold text-emerald-700 block">Sheet 2: Vendors</span>
                <span className="text-2xl font-bold text-emerald-900">{importPreview.vendors.length}</span>
                <span className="text-[10px] text-emerald-600 block mt-0.5">Records parsed</span>
              </div>

              <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-center">
                <span className="text-[11px] font-semibold text-purple-700 block">Sheet 3: Departments</span>
                <span className="text-2xl font-bold text-purple-900">{importPreview.departments.length}</span>
                <span className="text-[10px] text-purple-600 block mt-0.5">Records parsed</span>
              </div>
            </div>

            {importPreview.materials.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Materials Preview with Pricing & Promotion Window ({importPreview.materials.length} items)</span>
                  <span className="text-[10px] text-slate-500 font-normal">First 5 shown</span>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100/70 text-slate-600 font-semibold border-b border-slate-200 text-[11px]">
                      <tr>
                        <th className="p-2">SKU</th>
                        <th className="p-2">Product</th>
                        <th className="p-2 text-right">Cost Price</th>
                        <th className="p-2 text-right">Selling Price</th>
                        <th className="p-2 text-right">Promo Price</th>
                        <th className="p-2 text-center">Promo Period</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importPreview.materials.slice(0, 5).map((m: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50 font-mono text-[11px]">
                          <td className="p-2 font-bold text-blue-700">{m.sku}</td>
                          <td className="p-2 font-sans font-medium text-slate-800">{m.name}</td>
                          <td className="p-2 text-right text-slate-600">${Number(m.cost_price || 0).toFixed(2)}</td>
                          <td className="p-2 text-right font-bold text-emerald-700">${Number(m.selling_price || m.unitPrice || 0).toFixed(2)}</td>
                          <td className="p-2 text-right font-bold text-purple-700">
                            {m.promotion_price ? `$${Number(m.promotion_price).toFixed(2)}` : '—'}
                          </td>
                          <td className="p-2 text-center font-sans text-[10px]">
                            {m.promoStartDate || m.promoEndDate ? (
                              <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-200">
                                {m.promoStartDate || 'Now'} ~ {m.promoEndDate || 'Open'}
                              </span>
                            ) : (
                              <span className="text-slate-400">No promo period</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
              <Label className="font-semibold text-slate-800">Synchronization Strategy</Label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="syncStrategy"
                    checked={!importPreview.isOverwriting}
                    onChange={() => setImportPreview({ ...importPreview, isOverwriting: false })}
                    className="text-blue-600"
                  />
                  <span>Update & Merge (keep non-conflicting records)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="syncStrategy"
                    checked={importPreview.isOverwriting}
                    onChange={() => setImportPreview({ ...importPreview, isOverwriting: true })}
                    className="text-blue-600"
                  />
                  <span>Batch Overwrite</span>
                </label>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-slate-100 pt-3">
            <Button variant="outline" onClick={() => setImportPreview(prev => ({ ...prev, open: false }))}>
              Cancel
            </Button>
            <Button 
              onClick={handleCommitImport} 
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Commit Synchronization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
