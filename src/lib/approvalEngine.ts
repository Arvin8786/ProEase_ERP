import { 
  collection, 
  doc, 
  updateDoc, 
  addDoc, 
  Timestamp, 
  getDoc 
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  ApprovalStep, 
  ApprovalWorkflow, 
  UserProfile, 
  Employee 
} from '../types';

export const HIGH_VALUE_PR_THRESHOLD = 5000; // PRs above $5,000 require multi-level approval
export const HIGH_VALUE_WRITEOFF_THRESHOLD = 500; // Stock write-offs > $500 require escalation

/**
 * Builds the dynamic sequential approval steps based on staff hierarchy
 */
export function buildEscalationChain(
  staff: UserProfile | Employee | null,
  entityType: 'PR' | 'WRITE_OFF_973' | 'ISSUANCE_OVERRIDE_905',
  amount: number = 0
): ApprovalStep[] {
  const steps: ApprovalStep[] = [];

  // Check if staff has assigned escalation hierarchy
  const supervisorName = staff?.supervisorName || staff?.superiorName;
  const supervisorId = staff?.supervisorId || staff?.superiorId;
  const managerName = staff?.managerName;
  const managerId = staff?.managerId;
  const directorName = staff?.directorName;
  const directorId = staff?.directorId;

  const hasAssignedHierarchy = Boolean(supervisorName || managerName || directorName);

  if (hasAssignedHierarchy) {
    let currentLevel = 1;

    // Step 1: Supervisor verification
    if (supervisorName) {
      steps.push({
        level: currentLevel++,
        role: 'Supervisor',
        approverId: supervisorId,
        approverName: supervisorName,
        status: 'pending'
      });
    }

    // Step 2: Department Manager
    if (managerName) {
      steps.push({
        level: currentLevel++,
        role: 'Department Manager',
        approverId: managerId,
        approverName: managerName,
        status: 'pending'
      });
    }

    // Step 3: Executive Director (for high value or final escalation)
    if (directorName || amount >= HIGH_VALUE_PR_THRESHOLD) {
      steps.push({
        level: currentLevel++,
        role: 'Executive Director',
        approverId: directorId,
        approverName: directorName || 'Executive Director / Arvin (arvin8786@gmail.com)',
        approverEmail: 'arvin8786@gmail.com',
        status: 'pending'
      });
    }
  } else {
    // Single Entity / Unassigned staff: Route directly to Executive Director or Business Owner
    steps.push({
      level: 1,
      role: 'Executive Director / Owner',
      approverName: 'Business Owner & Director (arvin8786@gmail.com)',
      approverEmail: 'arvin8786@gmail.com',
      status: 'pending'
    });
  }

  return steps;
}

/**
 * Initiates an approval workflow and stores it in approvalWorkflows collection
 */
export async function createApprovalWorkflow(params: {
  entityType: 'PR' | 'WRITE_OFF_973' | 'ISSUANCE_OVERRIDE_905';
  entityId: string;
  documentNumber: string;
  requester: UserProfile | Employee;
  totalAmount?: number;
  departmentCode?: string;
  departmentName?: string;
}): Promise<string> {
  const {
    entityType,
    entityId,
    documentNumber,
    requester,
    totalAmount = 0,
    departmentCode,
    departmentName
  } = params;

  const steps = buildEscalationChain(requester, entityType, totalAmount);

  const workflow: Omit<ApprovalWorkflow, 'id'> = {
    entityType,
    entityId,
    documentNumber,
    requesterId: 'uid' in requester ? requester.uid : requester.id,
    requesterName: 'displayName' in requester ? requester.displayName : requester.fullName,
    requesterEmail: requester.email,
    departmentCode: departmentCode || requester.department,
    departmentName,
    totalAmount,
    currentStepIndex: 0,
    steps,
    overallStatus: 'pending',
    createdAt: Timestamp.now()
  };

  const docRef = await addDoc(collection(db, 'approvalWorkflows'), workflow);
  return docRef.id;
}

/**
 * Executes an action on a specific approval step
 */
export async function actionApprovalStep(params: {
  workflowId: string;
  stepIndex: number;
  action: 'approve' | 'reject';
  approver: UserProfile;
  notes?: string;
}): Promise<{ isCompleted: boolean; overallStatus: 'pending' | 'approved' | 'rejected' }> {
  const { workflowId, stepIndex, action, approver, notes } = params;

  const wfRef = doc(db, 'approvalWorkflows', workflowId);
  const wfSnap = await getDoc(wfRef);

  if (!wfSnap.exists()) {
    throw new Error('Approval workflow not found.');
  }

  const wfData = wfSnap.data() as ApprovalWorkflow;
  const steps = [...wfData.steps];

  if (stepIndex !== wfData.currentStepIndex) {
    throw new Error(`Step out of order. Current required step is level ${steps[wfData.currentStepIndex]?.level}`);
  }

  steps[stepIndex] = {
    ...steps[stepIndex],
    status: action === 'approve' ? 'approved' : 'rejected',
    approverId: approver.uid,
    approverName: approver.displayName,
    approverEmail: approver.email,
    actionedAt: Timestamp.now(),
    notes: notes || ''
  };

  if (action === 'reject') {
    await updateDoc(wfRef, {
      steps,
      overallStatus: 'rejected',
      completedAt: Timestamp.now()
    });
    return { isCompleted: true, overallStatus: 'rejected' };
  }

  // If approved, check if this was the final step
  const nextStepIndex = stepIndex + 1;
  const isFinalStep = nextStepIndex >= steps.length;

  if (isFinalStep) {
    await updateDoc(wfRef, {
      steps,
      currentStepIndex: nextStepIndex,
      overallStatus: 'approved',
      completedAt: Timestamp.now()
    });
    return { isCompleted: true, overallStatus: 'approved' };
  } else {
    await updateDoc(wfRef, {
      steps,
      currentStepIndex: nextStepIndex,
      overallStatus: 'pending'
    });
    return { isCompleted: false, overallStatus: 'pending' };
  }
}

/**
 * Validates whether the logged-in user can approve a given Purchase Requisition,
 * enforcing dynamic escalation for high-value orders (>= $5,000).
 */
export function canApprovePr(
  profile: UserProfile | null | undefined,
  prAmount: number
): { allowed: boolean; reason?: string } {
  if (!profile) return { allowed: false, reason: 'Authentication required' };
  if (profile.email === 'arvin8786@gmail.com') return { allowed: true };

  const role = profile.role?.toLowerCase() || '';
  const position = profile.position?.toLowerCase() || '';
  const isExec = role === 'admin' || role === 'owner' || position.includes('director') || position.includes('chief');

  if (prAmount >= HIGH_VALUE_PR_THRESHOLD) {
    if (!isExec) {
      return {
        allowed: false,
        reason: `High-value Requisition ($${prAmount.toFixed(2)} ≥ $${HIGH_VALUE_PR_THRESHOLD.toLocaleString()}) requires Executive Director or Arvin (arvin8786@gmail.com) authorization.`
      };
    }
    return { allowed: true };
  }

  const isMgr = role === 'manager' || position.includes('manager') || position.includes('head');
  if (isExec || isMgr) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'Requires Department Manager or Executive approval authority.' };
}

