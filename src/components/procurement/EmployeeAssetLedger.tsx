import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  orderBy 
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { StockMovementRecord, UserProfile, Employee } from '../../types';
import { 
  User, 
  Package, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Search, 
  FileText, 
  Filter, 
  BadgeCheck, 
  RotateCcw,
  Clock,
  ShieldCheck,
  Briefcase
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface EmployeeAssetLedgerProps {
  profile: UserProfile | null;
}

export const EmployeeAssetLedger: React.FC<EmployeeAssetLedgerProps> = ({ profile }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');
  const [movements, setMovements] = useState<StockMovementRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [movementFilter, setMovementFilter] = useState<'ALL' | '905' | '906' | '907' | '908'>('ALL');
  const [loading, setLoading] = useState(true);

  // Load active staff members
  useEffect(() => {
    const unsubEmp = onSnapshot(collection(db, 'employees'), (snap) => {
      const activeEmps = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Employee))
        .filter(e => e.isActive !== false && e.status !== 'inactive' && e.status !== 'terminated');
      setEmployees(activeEmps);
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      const activeUsers = snap.docs
        .map(d => d.data() as UserProfile)
        .filter(u => u.isActive !== false && u.status !== 'inactive');
      setUsers(activeUsers);
    });

    // Listen to all staff-related movements (905: Goods Issue to Employee, 906: Return, 907: Sales, 908: Return)
    const unsubMovements = onSnapshot(collection(db, 'stockMovements'), (snap) => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as StockMovementRecord))
        .filter(m => ['905', '906', '907', '908'].includes(m.movementCode));
      
      setMovements(list);
      setLoading(false);
    });

    return () => {
      unsubEmp();
      unsubUsers();
      unsubMovements();
    };
  }, []);

  // Combined unique active staff options
  const staffOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; dept?: string }>();
    users.forEach(u => {
      map.set(u.uid, {
        id: u.uid,
        name: u.displayName || u.email,
        dept: u.department
      });
    });
    employees.forEach(e => {
      if (!map.has(e.id)) {
        map.set(e.id, {
          id: e.id,
          name: e.fullName,
          dept: e.department
        });
      }
    });
    return Array.from(map.values());
  }, [users, employees]);

  // Filter movements by selected staff and movement type
  const filteredRecords = useMemo(() => {
    return movements.filter(m => {
      if (selectedStaffId !== 'ALL') {
        const matchesId = m.employeeId === selectedStaffId || m.executedById === selectedStaffId;
        const selectedStaffObj = staffOptions.find(s => s.id === selectedStaffId);
        const matchesName = selectedStaffObj && (m.employeeName === selectedStaffObj.name || m.executedBy === selectedStaffObj.name);
        if (!matchesId && !matchesName) return false;
      }

      if (movementFilter !== 'ALL' && m.movementCode !== movementFilter) {
        return false;
      }

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const docMatch = m.documentNumber.toLowerCase().includes(term);
        const skuMatch = m.sku?.toLowerCase().includes(term);
        const nameMatch = m.materialName?.toLowerCase().includes(term);
        const staffMatch = m.employeeName?.toLowerCase().includes(term);
        if (!docMatch && !skuMatch && !nameMatch && !staffMatch) return false;
      }

      return true;
    });
  }, [movements, selectedStaffId, movementFilter, searchTerm, staffOptions]);

  // Summary Metrics for selected staff
  const metrics = useMemo(() => {
    let issued905Count = 0;
    let returned906Count = 0;
    let sold907Count = 0;
    let refund908Count = 0;
    let activeHeldQty = 0;

    filteredRecords.forEach(m => {
      if (m.movementCode === '905') {
        issued905Count += m.quantity;
        activeHeldQty += m.quantity;
      } else if (m.movementCode === '906') {
        returned906Count += m.quantity;
        activeHeldQty = Math.max(0, activeHeldQty - m.quantity);
      } else if (m.movementCode === '907') {
        sold907Count += m.quantity;
      } else if (m.movementCode === '908') {
        refund908Count += m.quantity;
      }
    });

    return {
      issued905Count,
      returned906Count,
      sold907Count,
      refund908Count,
      activeHeldQty
    };
  }, [filteredRecords]);

  return (
    <div className="space-y-6">
      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-blue-100 text-blue-700 rounded-xl">
              <Briefcase className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Employee Movement & Asset Ledger</h2>
              <p className="text-xs text-slate-500">
                Itemized audit trail of employee goods issuances (905), returns (906), sales (907), and reverse logistics.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Employee Filter */}
          <div className="w-64">
            <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
              <SelectTrigger className="h-9 text-xs bg-slate-50 border-slate-200">
                <SelectValue placeholder="Select Staff Member..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Staff Members (Company-Wide)</SelectItem>
                {staffOptions.map(staff => (
                  <SelectItem key={staff.id} value={staff.id}>
                    {staff.name} {staff.dept ? `(${staff.dept})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Movement Code Filter */}
          <Select value={movementFilter} onValueChange={(v: any) => setMovementFilter(v)}>
            <SelectTrigger className="w-44 h-9 text-xs bg-slate-50 border-slate-200">
              <SelectValue placeholder="Movement Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All SAP Movements</SelectItem>
              <SelectItem value="905">905 - Goods Issue to Staff</SelectItem>
              <SelectItem value="906">906 - Return from Staff</SelectItem>
              <SelectItem value="907">907 - Staff / POS Purchase</SelectItem>
              <SelectItem value="908">908 - Cancel / Refund Sale</SelectItem>
            </SelectContent>
          </Select>

          {/* Search box */}
          <div className="relative w-48">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input 
              placeholder="Search doc #, SKU..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-8 h-9 text-xs bg-slate-50 border-slate-200"
            />
          </div>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-blue-200/80 bg-blue-50/40 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-700">Active Assets in Custody</span>
            <Package className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-blue-900 mt-2">
            {metrics.activeHeldQty} <span className="text-xs font-normal text-blue-600">PCS</span>
          </div>
          <div className="text-[11px] text-blue-600 mt-1">Pending return to warehouse</div>
        </Card>

        <Card className="border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Total Issued (905)</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-2">
            {metrics.issued905Count} <span className="text-xs font-normal text-slate-500">PCS</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Tools, equipment & uniforms</div>
        </Card>

        <Card className="border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Returned Assets (906)</span>
            <RotateCcw className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-2">
            {metrics.returned906Count} <span className="text-xs font-normal text-slate-500">PCS</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Safely handed back into stores</div>
        </Card>

        <Card className="border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Staff POS Purchases (907)</span>
            <ArrowUpRight className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-2">
            {metrics.sold907Count} <span className="text-xs font-normal text-slate-500">PCS</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Employee discounted sales</div>
        </Card>
      </div>

      {/* Ledger Table */}
      <Card className="border-slate-200/80 bg-white shadow-xs">
        <CardHeader className="p-4 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold text-slate-900">
                Itemized Employee Asset & Movement History
              </CardTitle>
              <CardDescription className="text-xs">
                Audited sequence numbers (45000XXXXX) tracking custody changes and purchases.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs font-mono">
              {filteredRecords.length} Records Found
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-xs font-semibold">Doc Number (45000XXXXX)</TableHead>
                  <TableHead className="text-xs font-semibold">SAP Code</TableHead>
                  <TableHead className="text-xs font-semibold">Item & SKU</TableHead>
                  <TableHead className="text-right text-xs font-semibold">Quantity</TableHead>
                  <TableHead className="text-xs font-semibold">Tracking # (Batch / Serial)</TableHead>
                  <TableHead className="text-xs font-semibold">Staff Member</TableHead>
                  <TableHead className="text-xs font-semibold">Authorized By</TableHead>
                  <TableHead className="text-xs font-semibold">Audit Notes</TableHead>
                  <TableHead className="text-xs font-semibold">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-slate-400 text-xs">
                      No stock movements found matching the selected filter criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRecords.map(m => {
                    const isIssuance = m.movementCode === '905';
                    const isReturn = m.movementCode === '906';
                    const isSale = m.movementCode === '907';
                    const dateStr = m.timestamp?.toDate ? m.timestamp.toDate().toLocaleString() : 'Recent';

                    return (
                      <TableRow key={m.id} className="hover:bg-slate-50/70">
                        <TableCell className="font-mono text-xs font-bold text-slate-900">
                          {m.documentNumber}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline"
                            className={`text-[10px] font-bold ${
                              isIssuance 
                                ? 'bg-blue-50 text-blue-700 border-blue-200' 
                                : isReturn 
                                ? 'bg-sky-50 text-sky-700 border-sky-200'
                                : isSale 
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            SAP {m.movementCode}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-xs text-slate-900">{m.materialName}</div>
                          <div className="font-mono text-[10px] text-slate-500">{m.sku}</div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold">
                          <span className={isIssuance || isSale ? 'text-slate-900' : 'text-sky-600'}>
                            {m.quantity} {m.unit}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-mono text-[11px]">
                          {m.serialNumber ? (
                            <span className="text-indigo-600">SN: {m.serialNumber}</span>
                          ) : m.batchNumber ? (
                            <span className="text-emerald-600">Batch: {m.batchNumber}</span>
                          ) : (
                            <span className="text-slate-400">Standard</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-medium text-slate-800">
                          {m.employeeName || m.executedBy || 'Staff'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {m.executedBy}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                          {m.reason || (isIssuance ? 'Asset Custody Assignment' : isSale ? 'POS Sales' : 'Returned')}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                          {dateStr}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
